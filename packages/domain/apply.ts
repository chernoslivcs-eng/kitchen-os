// Головне правило продукту: модель ніколи не пише в стан напряму.
// Все, що модель повертає — картка. Застосовує людина, натиснувши підтвердження.
// Тут — ідемпотентне застосування карток і undo.
//
// Ідемпотентність: applyCard(id, selected) можна викликати повторно з тим самим id
// і тими самими selected — результат буде такий самий (той самий undo_token),
// нічого в базу другого разу не запишеться. Це критично: сітка мобільна, повтори бувають.

import { randomUUID } from 'node:crypto';
import { ownsEvent, traditionsFrom } from './occasions.js';
import { appendProfileText, clampProfileText, profileTextHints } from './profile-text.js';
import { isProfileFieldCard } from './types.js';
import { rebuildVetoIndex } from './veto-index.js';
import type { Tradition } from './occasion-rules.js';
import { resolveLabelToZone, resolveLabelToKey } from '@kitchen/catalog';
import { BY_KEY } from '@kitchen/catalog/seed';
import type { Repo } from './repo.js';
import { normalizeTriple, displayName, catalogGroupsToAllergens, isCatalogFasting, type HouseholdProduct, type ProductTags, type ProductTriple } from './product.js';
import type {
  Card,
  EventCard,
  HouseholdEventRow,
  IntakeCard,
  IntakeOp,
  PantryBatch,
  PendingCard,
  UndoSnapshot,
  Provenance,
  EaterRow,
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
    dismissed_at: null,
  };
  await repo.savePending(pc);
  return pc;
}

// ---------- застосування ----------

export interface ApplyResult {
  applied: number;   // скільки ops дійсно ЛЯГЛО в стан у цьому виклику
  undo_token: string;
  already: boolean;  // true = повторний виклик, змін не було
  /** Мітки операцій, які не знайшли своєї позиції й нічого не зробили.
   *  Порожньо в переважній більшості випадків; непорожньо — привід
   *  подивитись у лог, бо людині сказали «Запишу», а стан не змінився.
   *  Заповнює поки лише гілка intake_diff. */
  missed?: string[];
  /** Картка event: id події на кожну операцію, вирівняно з card.ops
   *  (undefined — операція не приземлилась). Без цього картка в стрічці не
   *  знає, ЩО саме вона створила, і не може стати артефактом із правкою на
   *  місці: id народжується тут, у applyEventOp, і нікуди не повертався. */
  event_ids?: (string | undefined)[];
  /** Картка поля профілю (раунд 4): текст не вліз у ліміт і був обрізаний —
   *  картка все одно застосована, репліка має сказати, що не влізло. */
  truncated?: boolean;
}

export interface ApplyOpts {
  /** «Нічого такого» на картці поля `ban`: status none, картка застосована. */
  none?: boolean;
}

export async function applyCard(
  repo: Repo,
  card_id: string,
  selected: number[],
  actor_user_id: string,
  opts: ApplyOpts = {},
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

  // Раунд 4 §4: картка поля профілю. Один текст в одне поле; undo повертає
  // попереднє значення поля цілком (текст і статус).
  if (isProfileFieldCard(card)) {
    const key = card.field;
    if (opts.none && key !== 'ban') throw new Error('«Нічого такого» — лише для поля ban');
    const before = (await repo.getProfileText(actor_user_id)).fields[key];
    const snapshot: UndoSnapshot = {
      kind: 'profile',
      before: { profile_field_before: { field: key, value: { ...before } } },
    };
    let landed = 0;
    let truncated = false;
    if (opts.none) {
      await repo.patchProfileField(actor_user_id, key, { status: 'none' });
      landed = 1;
    } else {
      const add = (card.text ?? '').trim();
      if (add) {
        const next = card.mode === 'append' && before.status === 'filled'
          ? appendProfileText(key, before.text, add)
          : { text: clampProfileText(key, add), truncated: Array.from(add).length > Array.from(clampProfileText(key, add)).length };
        await repo.patchProfileField(actor_user_id, key, { text: next.text });
        truncated = next.truncated;
        landed = 1;
      }
    }
    if (landed) await rebuildVetoIndex(repo, actor_user_id, key);
    const undo_token = randomUUID();
    await repo.updatePending(pc.id, {
      applied_at: new Date().toISOString(),
      applied_ops: landed ? [0] : [],
      undo_token,
      undo_snapshot: snapshot,
    });
    await repo.markMessageApplied(pc.id, landed);
    return { applied: landed, undo_token, already: false, truncated };
  }

  // Кожен тип картки має власний обробник і власний знімок для undo.
  if (card.type === 'intake_diff') {
    // Захист від малформленої картки моделі (живий репро 01.09: shopping
    // прийшла з ops замість items) — `?? []` тут і на трьох інших типах
    // нижче: клік «Застосувати» на такій картці деградує до «0 застосовано»,
    // а не 500. TS думає card.ops завжди масив — жива відповідь моделі цю
    // гарантію не тримає.
    const chosen = selected.length ? selected : (card.ops ?? []).map((_, i) => i);
    const snapshot: UndoSnapshot = { kind: 'intake_diff', before: { created_batch_ids: [], modified_batches: [], checked_shopping_ids: [] } };
    // QA4-05 сформулював це для профілю: «рахуємо те, що СПРАВДІ лягло».
    // Гілка комори цього не робила — рахувала, скільки операцій ВИБРАЛИ.
    // Різниця видна, коли ціль зникла: deplete/correct/rename на неіснуючу
    // позицію тихо виходять, а картка рапортувала «1 позиція» і репліка
    // казала «Запишу». Тепер картка каже правду, а промахи їдуть у `missed`.
    let landed = 0;
    const missed: string[] = [];
    for (const idx of chosen) {
      const op = card.ops[idx];
      if (!op) continue;
      if (await applyIntakeOp(repo, op, pc.household_id, actor_user_id, snapshot)) landed++;
      else missed.push(`${op.op} «${op.label}»`);
    }
    // UX9-27: «купив X» закриває X у списку покупок. Інакше продукт одночасно
    // вважав, що олія В КОМОРІ і що олію ТРЕБА купити. Збіг — точний за назвою
    // (trim+lower); позицію не видаляємо, а відмічаємо купленою — людина бачить
    // її перекресленою, «→ В КОМОРУ» її вже не задвоїть (дедуп у unpack немає,
    // але checked-позиції людина розбирає свідомо).
    for (const idx of chosen) {
      const op = card.ops[idx];
      if (!op || op.op !== 'add') continue;
      const items = await repo.listShoppingItems(pc.household_id);
      const hit = items.find((i) => !i.checked && i.label.trim().toLowerCase() === op.label.trim().toLowerCase());
      if (hit) {
        await repo.toggleShoppingItem(hit.id, true);
        snapshot.before.checked_shopping_ids!.push(hit.id);
      }
    }
    const undo_token = randomUUID();
    await repo.updatePending(pc.id, {
      applied_at: new Date().toISOString(),
      applied_ops: chosen,
      undo_token,
      undo_snapshot: snapshot,
      card,
    });
    // Картку треба зберегти саме тут: applyIntakeOp щойно проставив у неї
    // batch_id, і без цього вказівники жили б лише в памʼяті процесу.
    await repo.updateMessageCard(pc.id, card);
    await repo.markMessageApplied(pc.id, landed);
    return { applied: landed, undo_token, already: false, missed };
  }

  if (card.type === 'shopping') {
    const chosen = selected.length ? selected : (card.items ?? []).map((_, i) => i);
    const snapshot: UndoSnapshot = { kind: 'shopping', before: { added_shopping_ids: [], removed_shopping_items: [] } };
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

  if (card.type === 'event') {
    const chosen = selected.length ? selected : (card.ops ?? []).map((_, i) => i);
    const snapshot: UndoSnapshot = { kind: 'event', before: { added_event_ids: [], events_before: [] } };
    let landed = 0;
    const event_ids: (string | undefined)[] = new Array(card.ops.length).fill(undefined);
    for (const idx of chosen) {
      const op = card.ops[idx];
      if (!op) continue;
      const addedBefore = snapshot.before.added_event_ids?.length ?? 0;
      const did = await applyEventOp(repo, op, pc.household_id, actor_user_id, snapshot);
      if (did) {
        landed++;
        // add → id щойно створеного рядка; edit/done/remove → той id, що прийшов.
        event_ids[idx] = op.op === 'add'
          ? snapshot.before.added_event_ids?.[addedBefore]
          : op.id;
      }
    }
    const undo_token = randomUUID();
    await repo.updatePending(pc.id, {
      applied_at: new Date().toISOString(),
      applied_ops: chosen,
      undo_token,
      undo_snapshot: snapshot,
    });
    await repo.markMessageApplied(pc.id, landed);
    return { applied: landed, undo_token, already: false, event_ids };
  }

  if (card.type === 'profile') {
    const chosen = selected.length ? selected : (card.ops ?? []).map((_, i) => i);
    // Крок 11: ops-картка — лише традиції (user.traditions) і домашні (їдці).
    // Текст людини йде карткою поля, нотатки — полем `note` відповіді.
    const user = await repo.getUser(actor_user_id);
    const tradBefore: Tradition[] | null = user?.traditions ? [...user.traditions] : null;
    const hints = profileTextHints(await repo.getProfileText(actor_user_id));
    let trads: Tradition[] | null = tradBefore ? [...tradBefore] : null;
    const snapshot: UndoSnapshot = { kind: 'profile', before: {} };
    // QA4-05: рахуємо те, що СПРАВДІ лягло.
    let landed = 0;
    let traditionsTouched = false;
    const memberTrace = { added: [] as string[], removed: [] as EaterRow[] };
    for (const idx of chosen) {
      const op = card.ops[idx];
      if (!op) continue;
      if (op.kind === 'member') {
        if (await applyMemberOp(repo, pc.household_id, op, memberTrace)) landed++;
        continue;
      }
      if (op.kind === 'tradition') {
        const next = applyTraditionOp(trads, hints, op);
        if (next) { trads = next; landed++; traditionsTouched = true; }
      }
    }
    if (memberTrace.added.length) snapshot.before.added_eater_ids = memberTrace.added;
    if (memberTrace.removed.length) snapshot.before.removed_eaters = memberTrace.removed;
    if (traditionsTouched) {
      // Знімок «до» — і null («не обирала»): undo має повернути саме здогад,
      // а не порожній вибір.
      snapshot.before.traditions_before = { value: tradBefore };
      await repo.setTraditions(actor_user_id, trads);
    }
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

  if (card.type === 'cook_photo') {
    const run = await repo.getCookRun(card.run_id);
    if (!run || run.user_id !== actor_user_id) throw new Error('forbidden');
    const att = await repo.getAttachment(card.attachment_id);
    if (!att) throw new Error('attachment not found');
    const now = new Date().toISOString();
    const snapshot: UndoSnapshot = {
      kind: 'cook_photo',
      before: { photo_before: { run_id: run.id, photo_url: run.photo_url } },
    };
    await repo.updateCookRun(run.id, { photo_url: att.url });
    const undo_token = randomUUID();
    await repo.updatePending(pc.id, {
      applied_at: now, applied_ops: [0], undo_token, undo_snapshot: snapshot,
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

// 01.09 живий репро: «Кроненбург 0.5 давай до замовлення» лягло в shopping-
// картку як { label: "Пиво Kronenbourg 0.5 л", v: null, u: null } — модель
// не витягла кількість у v/u, впаяла її текстом у саму назву. label потім
// іде БУКВАЛЬНИМ пошуковим запитом до Сільпо (retail.ts findBatch) — «0.5 л»
// не входить у жодну реальну назву товару, тому чесний товар не знаходиться,
// хоча чистий запит без хвоста його знаходить. Страхуємось тут, на вставці:
// якщо v/u НЕ прийшли з картки окремо, а в кінці label є «ЧИСЛО ОДИНИЦЯ» —
// переносимо в v/u (тим самим normalizeUnit), відрізаємо хвіст від label.
// Якщо v/u вже прийшли з картки — label не займаємо, навіть якщо там теж
// випадково є число-одиниця (могло бути частиною реальної назви SKU).
const TRAILING_QTY = /\s+(\d+(?:[.,]\d+)?)\s*(л|мл|кг|г|шт)\.?\s*$/i;

function extractTrailingQuantity(label: string): { label: string; value: number | null; unit: Unit | null } {
  const m = label.match(TRAILING_QTY);
  if (!m) return { label, value: null, unit: null };
  const rawValue = parseFloat(m[1]!.replace(',', '.'));
  const { value, unit } = normalizeUnit(rawValue, m[2]);
  if (value == null || unit == null) return { label, value: null, unit: null };
  return { label: label.slice(0, m.index).trim(), value, unit };
}

// Продукт дому за трійкою: знайомий реюзається, новий створюється з
// каталожними дефолтами в ДІРКИ тегів. Винесено з гілки `add` 02.09, бо
// знадобилось і для `rename`: перейменування «мʼясо» → «свинина» міняло
// лише видимий рядок, а партія й далі показувала на продукт «мʼясо» з його
// порожніми тегами. Людина відповідала на уточнення — і знання не додавалось.
//
// Продукт при undo партії НЕ видаляється: це довідник, наступна покупка тієї
// ж трійки має його знайти.
async function ensureProduct(
  repo: Repo,
  household_id: string,
  triple: ProductTriple,
  fallbackLabel: string,
  modelTags: ProductTags | undefined,
  unit: Unit | null,
): Promise<HouseholdProduct | null> {
  if (!triple.product) return null;
  const known = await repo.findProductByTriple(household_id, triple);
  // Знайома трійка — її теги істина дому, модельні ігноруються.
  if (known) return known;
  // Каталог (кроки 2-3): key по аліасах + дефолти в ДІРКИ тегів.
  // Межа жорстка: каталог дає властивості КЛАСУ (алергени, скоромність),
  // ніколи екземпляра — бренд/варіант/назву не чіпає; модельні теги
  // завжди перемагають каталожні.
  const key = resolveLabelToKey(triple.product) ?? resolveLabelToKey(fallbackLabel);
  const cat = key ? BY_KEY.get(key) : undefined;
  const tags: ProductTags = { ...(modelTags ?? {}) };
  if (cat) {
    if (tags.allergens === undefined) {
      const fromCat = catalogGroupsToAllergens(cat.allergen_groups);
      if (fromCat.length) tags.allergens = fromCat;
    }
    if (tags.fasting === undefined && isCatalogFasting(cat)) tags.fasting = true;
  }
  const product: HouseholdProduct = {
    id: randomUUID(),
    household_id,
    ...triple,
    unit: unit === 'pack' ? null : unit,
    pack_size: null,
    tags,
    catalog_key: key ?? null,
    created_at: new Date().toISOString(),
  };
  await repo.insertProduct(product);
  return product;
}

async function applyIntakeOp(
  repo: Repo,
  op: IntakeOp,
  household_id: string,
  actor: string,
  snap: UndoSnapshot,
  // Повертає true, якщо операція справді змінила стан. false означає, що
  // ціль не знайшлась — і тоді картка НЕ має рапортувати про зміну.
): Promise<boolean> {
  if (op.op === 'add') {
    const id = randomUUID();
    const provenance: Provenance = (op.evidence as Provenance) ?? 'user_statement';
    const norm = normalizeUnit(op.value, op.unit);

    // Черга Д (№2): партія показує на «продукт дому». Трійка з op (фолбек —
    // label як product).
    const triple = normalizeTriple({ product: op.product ?? op.label, brand: op.brand, variant: op.variant });
    const product = await ensureProduct(repo, household_id, triple, op.label, op.tags, norm.unit);

    const batch: PantryBatch = {
      id,
      household_id,
      // UX9-01 (той самий клас, що unpack): catalog_ingredient у БД порожня до
      // задачі «каталог 2341» — будь-який непорожній ключ валить insert по FK.
      catalog_key: null,
      // Видима назва ФОРМУЄТЬСЯ з трійки; op.label — фолбек без продукту.
      label: product ? displayName(product) : op.label,
      // QA6-06: коли модель не вказала зону — питаємо каталог, а не кладемо в `dry`.
      zone: (op.zone ?? resolveLabelToZone(op.label) ?? 'dry') as Zone,
      value: norm.value,
      unit: norm.unit,
      // «(початке)»: інвентар описує і відкриті упаковки — інакше стан
      // губився і годинник «вжити до» не стартував.
      state: op.state === 'opened' ? 'opened' : 'sealed',
      opened_at: op.state === 'opened' ? new Date().toISOString() : null,
      expires_at: null,
      // «відкр., дн» з тегів продукту — джерело м'якого «вжити до».
      best_before_opened_days: product?.tags.shelf_open_days ?? null,
      added_at: new Date().toISOString(),
      depleted_at: null,
      confidence: op.confidence ?? 1,
      provenance,
      staple: false,
      last_by: actor,
      last_action: 'add',
      product_id: product?.id ?? null,
    };
    await repo.insertBatch(batch);
    snap.before.created_batch_ids!.push(id);
    // Картка запамʼятовує, яку позицію вона показує. Напрямок односторонній:
    // позиція про картку не знає. Тому сесію можна видалити — зникне вікно,
    // не вміст холодильника.
    op.batch_id = id;
    return true;
  }

  // Вказівник сильніший за назву. Хто знає позицію — адресує її точно; назва
  // лишається фолбеком для того, хто не знає (модель). Без цього палець
  // рецепта на партію (ing.p) перетворювався на рядок і губився в
  // findBatchByLabel, який бере ПЕРШИЙ збіг без сортування.
  const byId = op.batch_id ? await repo.getBatch(op.batch_id) : null;
  const target = byId?.household_id === household_id
    ? byId
    : await repo.findBatchByLabel(household_id, op.label);
  if (!target) {
    // Мовчки не СТВОРЮЄМО — це правильно: одруківка моделі не має народжувати
    // позиції з повітря. Але й мовчки РАПОРТУВАТИ про зміну не можна: далі
    // false доходить до лічильника, і картка каже правду замість «застосовано».
    return false;
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
    // Перейменування — це не виправлення одруківки, а заява «це інший
    // продукт, ніж я сказав». Тому переобчислюємо трійку й продукт дому так
    // само, як на `add`: інакше «мʼясо» → «свинина» міняло тільки рядок на
    // екрані, а під ним лишався продукт «мʼясо» з порожніми тегами — без
    // алергенів, скоромності й ключа каталогу. Саме ці поля потім вирішують,
    // що асистент запропонує готувати, тож без цього уточнення в людини
    // питали дарма.
    const triple = normalizeTriple({ product: op.to });
    const product = await ensureProduct(repo, household_id, triple, op.to, undefined, target.unit);
    const patch: Partial<PantryBatch> = {
      label: product ? displayName(product) : op.to,
      product_id: product?.id ?? target.product_id ?? null,
      last_by: actor,
      last_action: 'rename',
    };
    // «Вжити до» йде за продуктом: партія тепер ІНША річ, і старий строк
    // описував не її. Але тільки коли новий продукт має що сказати —
    // затирати відоме порожнім гірше, ніж лишити як було.
    if (product?.tags.shelf_open_days != null) {
      patch.best_before_opened_days = product.tags.shelf_open_days;
    }
    // Зону НЕ чіпаємо навмисно. Вона має власну операцію (`correct` із
    // zone), і мовчазний переїзд партії з холодильника в морозилку через
    // перейменування був би сюрпризом, якого людина не просила.
    await repo.updateBatch(target.id, patch);
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
    // Черга Д (№2): правка невидимих тегів — мердж у продукт партії.
    // Undo-снапшот продукту не робимо: теги — довідник, а не стан комори;
    // наступний correct поверне як треба.
    if (op.tags && target.product_id) {
      const prod = await repo.getProduct(target.product_id);
      if (prod) await repo.updateProduct(prod.id, { tags: { ...prod.tags, ...op.tags } });
    }
  }
  return true;
}

/**
 * Одна операція над подією дому.
 *
 * `rule` сюди приходить уже порахованим: модель передає «за тиждень», сервер
 * перетворює це на дату ще при народженні картки (services/api/event-when.ts).
 * Тут дат не рахують — інакше правило «модель не рахує дати» протекло б у
 * домен, і в картці стрічки стояло б одне, а в базі інше.
 *
 * Повертає false, коли операція нічого не змінила: посилання на подію, якої
 * немає, — не привід рапортувати про зроблене.
 */
async function applyEventOp(
  repo: Repo,
  op: EventCard['ops'][number],
  household_id: string,
  actor_user_id: string,
  snap: UndoSnapshot,
): Promise<boolean> {
  if (op.op === 'add') {
    if (!op.title?.trim() || !op.rule) return false;
    const row: HouseholdEventRow = {
      id: randomUUID(), household_id,
      kind: op.kind ?? 'custom',
      title: op.title.trim(),
      note: op.note ?? null,
      rule: op.rule,
      // Обмеження дім собі не пише: піст приходить із довідника, а тверда межа
      // без тексту — порожня обіцянка. Той самий інваріант тримає CHECK у 0017.
      force: 'hint', restricts: null,
      buy: [], recipe_id: null,
      servings: op.servings ?? null,
      supply: op.supply ?? null,
      created_by: actor_user_id,
      // Слід авторства: подія, написана моделлю, відрізняється від написаної
      // руками — інакше неможливо розібрати, звідки в календарі те, чого не
      // просили.
      source: 'model',
      expires_at: null, done_at: null,
      created_at: new Date().toISOString(),
    };
    await repo.insertHouseholdEvent(row);
    snap.before.added_event_ids?.push(row.id);
    return true;
  }

  if (!op.id) return false;
  const existing = await repo.getHouseholdEvent(op.id);
  // Чуже не чіпаємо навіть за прямим id: модель могла взяти його з попередньої
  // сесії іншого дому — або з календаря іншої людини в цьому ж домі.
  if (!existing || !ownsEvent(existing, household_id, actor_user_id)) return false;
  snap.before.events_before?.push(existing);

  if (op.op === 'remove') {
    await repo.deleteHouseholdEvent(op.id);
    return true;
  }
  if (op.op === 'done') {
    await repo.updateHouseholdEvent(op.id, { done_at: new Date().toISOString() });
    return true;
  }
  // edit: чіпаємо лише те, що названо. Порожній патч — не зміна.
  const patch: Parameters<Repo['updateHouseholdEvent']>[1] = {};
  if (op.title?.trim()) patch.title = op.title.trim();
  if ('note' in op) patch.note = op.note ?? null;
  if (op.rule) patch.rule = op.rule;
  if ('servings' in op) patch.servings = op.servings ?? null;
  if ('supply' in op) patch.supply = op.supply ?? null;
  if (!Object.keys(patch).length) return false;
  await repo.updateHouseholdEvent(op.id, patch);
  return true;
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
      // Повний рядок, не тільки id — після delete рядка вже нема в БД,
      // undo мусить його ВІДТВОРИТИ, не просто «знати, що він був».
      snap.before.removed_shopping_items ??= [];
      snap.before.removed_shopping_items.push(existing);
    }
    return;
  }
  // Дефолт — add. v/u не прийшли окремо — перевіряємо, чи кількість не
  // впаялась текстом у хвіст label (живий репро «Kronenbourg 0.5 л»).
  const extracted = item.v == null && item.u == null
    ? extractTrailingQuantity(item.label)
    : { label: item.label, value: item.v ?? null, unit: item.u ?? null };
  // Якщо вже є з тим самим (очищеним) label — не дублюємо.
  const existing = await repo.findShoppingItemByLabel(household_id, extracted.label);
  if (existing) return;
  const id = randomUUID();
  await repo.insertShoppingItem({
    id, household_id,
    label: extracted.label,
    reason: item.note ?? null,
    value: extracted.value,
    unit: extracted.unit,
    zone: null,
    checked: false,
    added_by: actor,
    source: 'model',
    created_at: new Date().toISOString(),
  });
  snap.before.added_shopping_ids ??= [];
  snap.before.added_shopping_ids.push(id);
}

// «Зі мною живе Оксана, вона веганка» → окремий запис їдця в домі.
// Обмеження лежать у ньому, а не в профілі власника. Прототип, 2160:
// «Обмеження учасника кладуться в його ж запис».
async function applyMemberOp(
  repo: Repo,
  household_id: string,
  op: {
    op?: 'add' | 'remove'; label?: string;
    diet?: unknown; allergies?: unknown; wishes?: unknown; antipatterns?: unknown; avoid?: unknown;
    [k: string]: unknown;
  },
  trace: { added: string[]; removed: EaterRow[] },
): Promise<boolean> {
  const name = (op.label ?? '').trim();
  if (!name) return false;
  const existing = await repo.findEaterByName(household_id, name);
  if (op.op === 'remove') {
    if (!existing) return false;
    await repo.deleteEater(existing.id);
    trace.removed.push(existing);
    return true;
  }
  if (existing) return false;
  const strs = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
  const diet = typeof op.diet === 'string' && op.diet.trim() ? [op.diet.trim()] : [];
  const eater: EaterRow = {
    id: randomUUID(),
    household_id,
    name,
    allergies: strs(op.allergies),
    // Дієта — це побажання, як і в профілі власника: окремого поля немає.
    wishes: [...new Set([...diet, ...strs(op.wishes)])],
    antipatterns: [...strs(op.antipatterns), ...strs(op.avoid)],
    created_at: new Date().toISOString(),
  };
  await repo.insertEater(eater);
  trace.added.push(eater.id);
  return true;
}

// Традиція — перемикач календаря на user.traditions. Перший дотик матеріалізує
// здогад: людина, яка вимикає «православні», розпізнані з «постуємо», має
// отримати вибір без них, а не той самий здогад назад зі своїх слів.
// Повертає новий масив або null, якщо операція нічого не змінила (QA4-05:
// applied рахує лише те, що справді лягло).
export function applyTraditionOp(
  current: Tradition[] | null,
  hints: string[],
  op: { op?: 'add' | 'remove'; label?: string },
): Tradition[] | null {
  const label = (op.label ?? '').trim() as Tradition;
  if (!TRADITIONS.includes(label)) return null;
  const chosen = Array.isArray(current);
  const cur = new Set<Tradition>(current ?? traditionsFrom(hints));
  if (op.op === 'remove') {
    if (!cur.has(label) && chosen) return null;
    cur.delete(label);
  } else {
    if (cur.has(label) && chosen) return null;
    cur.add(label);
  }
  return TRADITIONS.filter((t) => cur.has(t));
}

const TRADITIONS: Tradition[] = ['orthodox', 'catholic', 'islamic', 'jewish'];

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
  // Shopping: додані ідуть на видалення.
  for (const id of snap.before.added_shopping_ids ?? []) {
    await repo.deleteShoppingItem(id);
  }
  // M13 01.09: видалені відтворюються повним рядком (той самий id — знову
  // тим самим рецептом, що removed_eaters нижче). auto-apply зробив цей
  // шлях живим щодня, тому «undo не повертає X» більше не прийнятне.
  for (const row of snap.before.removed_shopping_items ?? []) {
    await repo.insertShoppingItem(row);
  }
  // UX9-27: intake відмітив куплене — undo повертає галочку назад.
  for (const id of snap.before.checked_shopping_ids ?? []) {
    await repo.toggleShoppingItem(id, false);
  }
  // Висновки: точковий відкат — видаляємо рівно те, що ця картка додала.
  for (const id of snap.before.added_eater_ids ?? []) {
    await repo.deleteEater(id);
  }
  // Видалений їдець повертається з усіма обмеженнями — знімок повний.
  for (const e of snap.before.removed_eaters ?? []) {
    await repo.insertEater(e);
  }
  if (snap.before.photo_before) {
    await repo.updateCookRun(snap.before.photo_before.run_id, { photo_url: snap.before.photo_before.photo_url });
  }
  // Імпортований рецепт: прибираємо рядок цілком — на нього ще ніщо не
  // посилається, і «незбережений» привид у базі нікому не потрібен.
  for (const id of snap.before.added_recipe_ids ?? []) {
    await repo.deleteRecipe(id);
  }
  // Події: додані видаляємо, змінені й видалені повертаємо повним рядком.
  // Порядок важливий — спершу зняти створене, потім відтворити старе, інакше
  // подія, яку картка видалила й створила заново, лишилась би в двох копіях.
  for (const id of snap.before.added_event_ids ?? []) {
    await repo.deleteHouseholdEvent(id);
  }
  for (const e of snap.before.events_before ?? []) {
    const still = await repo.getHouseholdEvent(e.id);
    if (still) await repo.updateHouseholdEvent(e.id, {
      title: e.title, note: e.note, rule: e.rule, buy: e.buy,
      servings: e.servings, supply: e.supply,
      expires_at: e.expires_at, done_at: e.done_at,
    });
    else await repo.insertHouseholdEvent(e);
  }
  // Традиції: назад попередній вибір (і null — «не обирала»).
  if (snap.before.traditions_before) {
    await repo.setTraditions(actor_user_id, snap.before.traditions_before.value);
  }
  // Раунд 4: поле профілю — назад попередній текст і статус.
  if (snap.before.profile_field_before) {
    const { field, value } = snap.before.profile_field_before;
    await repo.patchProfileField(actor_user_id, field,
      value.status === 'none' ? { status: 'none' } : { text: value.status === 'filled' ? value.text : '' });
    await rebuildVetoIndex(repo, actor_user_id, field);
  }

  await repo.updatePending(pc.id, { undone_at: new Date().toISOString() });
  await repo.markMessageApplied(pc.id, 0);
  return { undone: true, already: false };
}

// ---------- dismiss ----------

// Аудит раунд 3, крок 1: «Ні» на pending-картці (профіль, продиктований
// рецепт, пропозиція). Досі це був чисто клієнтський React-стан (Feed.tsx) —
// не переживав F5 і не потрапляв в історію, яку читає модель: перезавантаж
// сторінку, і картка знову «чекає тапу», хоча людина вже сказала ні.
//
// На відміну від undo — тут нема чого відкочувати: dismiss можливий лише
// ДО застосування (dismissCard на застосованій картці кидає помилку; шлях
// назад для застосованого — undo, не dismiss). Тому й немає undo_snapshot.
export async function dismissCard(
  repo: Repo,
  card_id: string,
  actor_user_id: string,
): Promise<{ dismissed: boolean; already: boolean }> {
  const pc = await repo.getPending(card_id);
  if (!pc) throw new Error(`card not found: ${card_id}`);
  if (pc.user_id !== actor_user_id) throw new Error('forbidden');
  if (pc.applied_at) throw new Error('already applied, use undo');
  if (pc.dismissed_at) return { dismissed: true, already: true };

  await repo.updatePending(pc.id, { dismissed_at: new Date().toISOString() });
  return { dismissed: true, already: false };
}
