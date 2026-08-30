// Головне правило продукту: модель ніколи не пише в стан напряму.
// Все, що модель повертає — картка. Застосовує людина, натиснувши підтвердження.
// Тут — ідемпотентне застосування intake_diff і undo. Profile/Shopping/Proposal — далі.
//
// Ідемпотентність: applyCard(id, selected) можна викликати повторно з тим самим id
// і тими самими selected — результат буде такий самий (той самий undo_token),
// нічого в базу другого разу не запишеться. Це критично: сітка мобільна, повтори бувають.

import { randomUUID } from 'node:crypto';
import { resolveLabelToZone } from '@kitchen/catalog';
import type { Repo } from './repo.js';
import type {
  Card,
  IntakeCard,
  IntakeOp,
  PantryBatch,
  PendingCard,
  UndoSnapshot,
  Provenance,
  Profile,
  ProfileKind,
  ShoppingItemRow,
  Zone,
  Unit,
} from './types.js';

// ---------- створення картки на застосуванні ----------

export interface CreatePendingArgs {
  message_id: string;
  household_id: string;
  user_id: string;
  card: Card;
}

export async function createPending(repo: Repo, args: CreatePendingArgs): Promise<PendingCard> {
  const existing = await repo.getPending(args.message_id);
  if (existing) return existing;
  const pc: PendingCard = {
    id: args.message_id,
    message_id: args.message_id,
    household_id: args.household_id,
    user_id: args.user_id,
    card: args.card,
    applied_at: null,
    applied_ops: null,
    undo_token: null,
    undo_snapshot: null,
    undone_at: null,
  };
  await repo.savePending(pc);
  return pc;
}

// ---------- застосування ----------

export interface ApplyResult {
  applied: number;   // скільки ops дійсно застосовано в цьому виклику
  undo_token: string;
  already: boolean;  // true = повторний виклик, змін не було
}

export async function applyCard(
  repo: Repo,
  card_id: string,
  selected: number[],
  actor_user_id: string,
): Promise<ApplyResult> {
  const pc = await repo.getPending(card_id);
  if (!pc) throw new Error(`card not found: ${card_id}`);
  if (pc.user_id !== actor_user_id) throw new Error('forbidden');
  if (pc.undone_at) throw new Error('card was undone; create a new one');
  if (pc.applied_at) {
    // Ідемпотентно: повертаємо той самий undo_token.
    return { applied: 0, undo_token: pc.undo_token!, already: true };
  }

  const { card } = pc;

  // Кожен тип картки має власний обробник і власний знімок для undo.
  if (card.type === 'intake_diff') {
    const chosen = selected.length ? selected : card.ops.map((_, i) => i);
    const snapshot: UndoSnapshot = { kind: 'intake_diff', before: { created_batch_ids: [], modified_batches: [] } };
    for (const idx of chosen) {
      const op = card.ops[idx];
      if (!op) continue;
      await applyIntakeOp(repo, op, pc.household_id, actor_user_id, snapshot);
    }
    const undo_token = randomUUID();
    await repo.updatePending(pc.id, {
      applied_at: new Date().toISOString(),
      applied_ops: chosen,
      undo_token,
      undo_snapshot: snapshot,
    });
    await repo.markMessageApplied(pc.id, chosen.length);
    return { applied: chosen.length, undo_token, already: false };
  }

  if (card.type === 'shopping') {
    const chosen = selected.length ? selected : card.items.map((_, i) => i);
    const snapshot: UndoSnapshot = { kind: 'shopping', before: { added_shopping_ids: [], removed_shopping_ids: [] } };
    for (const idx of chosen) {
      const item = card.items[idx];
      if (!item) continue;
      await applyShoppingOp(repo, item, pc.household_id, actor_user_id, snapshot);
    }
    const undo_token = randomUUID();
    await repo.updatePending(pc.id, {
      applied_at: new Date().toISOString(),
      applied_ops: chosen,
      undo_token,
      undo_snapshot: snapshot,
    });
    await repo.markMessageApplied(pc.id, chosen.length);
    return { applied: chosen.length, undo_token, already: false };
  }

  if (card.type === 'profile') {
    const chosen = selected.length ? selected : card.ops.map((_, i) => i);
    const before = await repo.getProfile(actor_user_id);
    // QA4-04: {...before} — поверхнева копія, next.allergies це ТОЙ САМИЙ масив,
    // що before.allergies. applyProfileOp робить push і мутує масив, на який
    // дивиться знімок → undo фіксував стан ПІСЛЯ зміни. Глибока копія обов'язкова.
    const deepCopy = (p: Profile): Profile => ({
      ...p,
      allergies: [...p.allergies],
      wishes: [...p.wishes],
      antipatterns: [...p.antipatterns],
      equipment: { ...p.equipment },
    });
    const snapshot: UndoSnapshot = {
      kind: 'profile',
      before: { profile_before: before ? deepCopy(before) : undefined },
    };
    const next: Profile = before
      ? deepCopy(before)
      : { user_id: actor_user_id, allergies: [], wishes: [], antipatterns: [], equipment: {} };
    // QA4-05: рахуємо те, що СПРАВДІ лягло. `kind: member` MVP ще ігнорує,
    // але раніше API рапортував applied:1 і UI показував успіх — людина думала,
    // що продукт знає про вегетаріанку в домі, а в профілі нічого не було.
    let landed = 0;
    // Висновки не входять у документ профілю — вони окремі рядки, тож і
    // застосовуються окремо, і відкочуються поштучно.
    const added_note_ids: string[] = [];
    for (const idx of chosen) {
      const op = card.ops[idx];
      if (!op) continue;
      if (op.kind === 'note') {
        if (await applyNoteOp(repo, actor_user_id, op, added_note_ids)) landed++;
        continue;
      }
      if (applyProfileOp(next, op)) landed++;
    }
    if (added_note_ids.length) snapshot.before.added_note_ids = added_note_ids;
    await repo.upsertProfile(next);
    const undo_token = randomUUID();
    await repo.updatePending(pc.id, {
      applied_at: new Date().toISOString(),
      applied_ops: chosen,
      undo_token,
      undo_snapshot: snapshot,
    });
    await repo.markMessageApplied(pc.id, landed);
    return { applied: landed, undo_token, already: false };
  }

  if (card.type === 'recipe') {
    const r = card.recipe;
    const now = new Date().toISOString();
    const id = randomUUID();
    await repo.saveRecipe({
      id,
      owner_id: actor_user_id,
      // Те, що людина принесла з книжки, і те, що вигадала модель, — різні речі.
      origin: 'imported',
      title: r.t,
      descr: r.d ?? null,
      character: r.ch ?? null,
      risk: r.rk ?? null,
      base_servings: r.sv ?? 2,
      time_total: r.tm ?? null,
      nutrition: r.nu ?? null,
      payload: r,
      created_at: now,
      // Імпорт — це і є намір зберегти; окремого «на потім» тут не питаємо.
      saved_at: now,
    });
    const undo_token = randomUUID();
    await repo.updatePending(pc.id, {
      applied_at: now,
      applied_ops: [0],
      undo_token,
      undo_snapshot: { kind: 'recipe', before: { added_recipe_ids: [id] } },
    });
    await repo.markMessageApplied(pc.id, 1);
    return { applied: 1, undo_token, already: false };
  }

  throw new Error(`apply not implemented for card type: ${(card as { type: string }).type}`);
}

// Модель повертає одиниці людською мовою («l», «kg», «літр», «шт»), а БД тримає
// вужчий словник (g/ml/pcs/pack). Приводимо тут, до вставки, і множимо value —
// щоб 0.25 л напою стало 250 мл, а не впало на check constraint.
function normalizeUnit(value: number | undefined | null, unit: string | undefined | null): { value: number | null; unit: Unit | null } {
  if (value == null && unit == null) return { value: null, unit: null };
  const u = (unit ?? '').toLowerCase().trim();
  const v = value ?? null;
  // Прямі співпадіння з нашим словником
  if (u === 'g' || u === 'г' || u === 'гр') return { value: v, unit: 'g' };
  if (u === 'ml' || u === 'мл') return { value: v, unit: 'ml' };
  if (u === 'pcs' || u === 'pc' || u === 'шт' || u === 'штук') return { value: v, unit: 'pcs' };
  if (u === 'pack' || u === 'упак' || u === 'пачка' || u === 'упаковка') return { value: v, unit: 'pack' };
  // Конверсії
  if (u === 'kg' || u === 'кг' || u === 'кілограм') {
    return { value: v == null ? null : Math.round(v * 1000), unit: 'g' };
  }
  if (u === 'l' || u === 'л' || u === 'літр' || u === 'liter' || u === 'litre') {
    return { value: v == null ? null : Math.round(v * 1000), unit: 'ml' };
  }
  // Невідома одиниця — value лишаємо як міру-без-одиниці немає сенсу, ставимо null.
  // Це рідкий випадок; якщо стане частим — розширимо словник, а не check constraint.
  return { value: null, unit: null };
}

async function applyIntakeOp(
  repo: Repo,
  op: IntakeOp,
  household_id: string,
  actor: string,
  snap: UndoSnapshot,
): Promise<void> {
  if (op.op === 'add') {
    const id = randomUUID();
    const provenance: Provenance = (op.evidence as Provenance) ?? 'user_statement';
    const norm = normalizeUnit(op.value, op.unit);
    const batch: PantryBatch = {
      id,
      household_id,
      catalog_key: op.catalog_key ?? null,
      label: op.label,
      // QA6-06: коли модель не вказала зону — питаємо каталог, а не кладемо в `dry`.
      zone: (op.zone ?? resolveLabelToZone(op.label) ?? 'dry') as Zone,
      value: norm.value,
      unit: norm.unit,
      state: 'sealed',
      opened_at: null,
      expires_at: null,
      best_before_opened_days: null,
      added_at: new Date().toISOString(),
      depleted_at: null,
      confidence: op.confidence ?? 1,
      provenance,
      staple: false,
      last_by: actor,
      last_action: 'add',
    };
    await repo.insertBatch(batch);
    snap.before.created_batch_ids!.push(id);
    return;
  }

  const target = await repo.findBatchByLabel(household_id, op.label);
  if (!target) {
    // Мовчки не створюємо: «модель не пише в стан напряму» стосується і одруківок.
    // Якщо треба додати — це має бути окрема op:add.
    return;
  }
  snap.before.modified_batches!.push({ ...target });

  if (op.op === 'deplete') {
    await repo.updateBatch(target.id, {
      state: 'depleted',
      depleted_at: new Date().toISOString(),
      last_by: actor,
      last_action: 'deplete',
    });
  } else if (op.op === 'open') {
    const days = target.best_before_opened_days;
    const expires_at = days ? new Date(Date.now() + days * 86_400_000).toISOString() : target.expires_at;
    await repo.updateBatch(target.id, {
      state: 'opened',
      opened_at: new Date().toISOString(),
      expires_at,
      last_by: actor,
      last_action: 'open',
    });
  } else if (op.op === 'rename') {
    await repo.updateBatch(target.id, {
      label: op.to,
      last_by: actor,
      last_action: 'rename',
    });
  } else if (op.op === 'correct') {
    const patch: Partial<PantryBatch> = { last_by: actor, last_action: 'correct' };
    if (op.value !== undefined || op.unit !== undefined) {
      // Пропускаємо і value, і unit через normalizeUnit разом, щоб
      // конверсія «0.25 л» → 250 мл спрацювала і для correction теж.
      const norm = normalizeUnit(op.value, op.unit);
      if (norm.value !== null) patch.value = norm.value;
      if (norm.unit !== null) patch.unit = norm.unit;
    }
    if (op.zone !== undefined) patch.zone = op.zone;
    await repo.updateBatch(target.id, patch);
  }
}

async function applyShoppingOp(
  repo: Repo,
  item: { op?: 'add' | 'remove'; label?: string; note?: string; v?: number; u?: string },
  household_id: string,
  actor: string,
  snap: UndoSnapshot,
): Promise<void> {
  if (!item.label) return;
  if (item.op === 'remove') {
    const existing = await repo.findShoppingItemByLabel(household_id, item.label);
    if (existing) {
      await repo.deleteShoppingItem(existing.id);
      snap.before.removed_shopping_ids ??= [];
      snap.before.removed_shopping_ids.push(existing.id);
    }
    return;
  }
  // Дефолт — add. Якщо вже є з тим самим label — не дублюємо.
  const existing = await repo.findShoppingItemByLabel(household_id, item.label);
  if (existing) return;
  const id = randomUUID();
  await repo.insertShoppingItem({
    id, household_id,
    label: item.label,
    reason: item.note ?? null,
    value: item.v ?? null,
    unit: item.u ?? null,
    zone: null,
    checked: false,
    added_by: actor,
    source: 'model',
    created_at: new Date().toISOString(),
  });
  snap.before.added_shopping_ids ??= [];
  snap.before.added_shopping_ids.push(id);
}

// Повертає true, якщо операція реально змінила профіль. Виклик-сайт рахує це
// як `applied` — щоб не рапортувати успіх на op, яку MVP не вміє (QA4-05).
// Висновок про страву: «фует знімати, щойно краї хрусткі». Тільки текст —
// решта полів (до чого, з якою оцінкою) заповнюється, коли висновок народжується
// в cook-run, а не в розмові.
async function applyNoteOp(
  repo: Repo,
  user_id: string,
  op: { op?: 'add' | 'remove'; label?: string; pin?: boolean; [k: string]: unknown },
  added: string[],
): Promise<boolean> {
  const text = (op.label ?? '').trim();
  if (!text) return false;
  const existing = await repo.findNoteByText(user_id, text);
  if (op.op === 'remove') {
    if (!existing) return false;
    await repo.deleteNote(existing.id);
    return true;
  }
  // Той самий висновок двічі — не помилка, але й не подія. QA4-05: раніше API
  // рапортував applied:1 там, де в базі нічого не змінилось.
  if (existing) return false;
  const id = randomUUID();
  await repo.insertNote({
    id, user_id, text,
    recipe_title: typeof op.recipe_title === 'string' ? op.recipe_title : null,
    rating: typeof op.rating === 'number' ? op.rating : null,
    pinned: op.pin === true,
    created_at: new Date().toISOString(),
  });
  added.push(id);
  return true;
}

export function applyProfileOp(
  next: Profile,
  op: { op?: 'add' | 'remove'; kind?: ProfileKind; label?: string; has?: boolean },
): boolean {
  if (!op.label || !op.kind) return false;
  const label = op.label.trim();
  const removing = op.op === 'remove';
  const listByKind = (k: ProfileKind): string[] | null => {
    if (k === 'allergy') return next.allergies;
    if (k === 'wish') return next.wishes;
    if (k === 'anti') return next.antipatterns;
    return null;
  };
  const list = listByKind(op.kind);
  if (list) {
    if (removing) {
      const idx = list.findIndex((x) => x.toLowerCase() === label.toLowerCase());
      if (idx === -1) return false;
      list.splice(idx, 1);
      return true;
    }
    if (list.some((x) => x.toLowerCase() === label.toLowerCase())) return false;
    list.push(label);
    return true;
  }
  if (op.kind === 'equip') {
    if (removing) {
      if (!(label in next.equipment)) return false;
      delete next.equipment[label];
      return true;
    }
    // QA5-04: «в мене немає духовки» модель віддає як {kind:'equip', has:false},
    // а ми безумовно писали 'has' — і потім пропонували запікати в духовці.
    // serializeProfile розрізняє has/lacks, але 'lacks' ніде не записувалось.
    next.equipment[label] = op.has === false ? 'lacks' : 'has';
    return true;
  }
  // note / member — MVP не має для них таблиць. Повертаємо false, щоб API не
  // рапортував applied:1 на те, що нікуди не лягло.
  return false;
}

// ---------- undo ----------

export async function undoCard(
  repo: Repo,
  card_id: string,
  undo_token: string,
  actor_user_id: string,
): Promise<{ undone: boolean; already: boolean }> {
  const pc = await repo.getPending(card_id);
  if (!pc) throw new Error(`card not found: ${card_id}`);
  if (pc.user_id !== actor_user_id) throw new Error('forbidden');
  if (!pc.applied_at) throw new Error('nothing to undo');
  if (pc.undo_token !== undo_token) throw new Error('undo_token mismatch');
  if (pc.undone_at) return { undone: false, already: true };
  if (!pc.undo_snapshot) throw new Error('no undo snapshot');

  const snap = pc.undo_snapshot;
  for (const id of snap.before.created_batch_ids ?? []) {
    await repo.deleteBatch(id);
  }
  for (const b of snap.before.modified_batches ?? []) {
    await repo.updateBatch(b.id, b);
  }
  // Shopping: додані ідуть на видалення. Видалені лишаються видаленими —
  // ми не тримаємо їх «повного тіла» на цьому кроці. Це прийнятне спрощення
  // для MVP: undo після «прибери X» не поверне X назад.
  for (const id of snap.before.added_shopping_ids ?? []) {
    await repo.deleteShoppingItem(id);
  }
  // Висновки: точковий відкат — видаляємо рівно те, що ця картка додала.
  for (const id of snap.before.added_note_ids ?? []) {
    await repo.deleteNote(id);
  }
  // Імпортований рецепт: прибираємо рядок цілком — на нього ще ніщо не
  // посилається, і «незбережений» привид у базі нікому не потрібен.
  for (const id of snap.before.added_recipe_ids ?? []) {
    await repo.deleteRecipe(id);
  }
  // Profile: повертаємо блок як був до застосування картки.
  if (snap.before.profile_before) {
    await repo.upsertProfile(snap.before.profile_before);
  }

  await repo.updatePending(pc.id, { undone_at: new Date().toISOString() });
  await repo.markMessageApplied(pc.id, 0);
  return { undone: true, already: false };
}
