// Головне правило продукту: модель ніколи не пише в стан напряму.
// Все, що модель повертає — картка. Застосовує людина, натиснувши підтвердження.
// Тут — ідемпотентне застосування intake_diff і undo. Profile/Shopping/Proposal — далі.
//
// Ідемпотентність: applyCard(id, selected) можна викликати повторно з тим самим id
// і тими самими selected — результат буде такий самий (той самий undo_token),
// нічого в базу другого разу не запишеться. Це критично: сітка мобільна, повтори бувають.

import { randomUUID } from 'node:crypto';
import type { Repo } from './repo.js';
import type {
  Card,
  IntakeCard,
  IntakeOp,
  PantryBatch,
  PendingCard,
  UndoSnapshot,
  Provenance,
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

  if (pc.card.type !== 'intake_diff') {
    // Інші типи — на наступних кроках.
    throw new Error(`apply not implemented for card type: ${pc.card.type}`);
  }

  const { card } = pc;
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

  return { applied: chosen.length, undo_token, already: false };
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
    const batch: PantryBatch = {
      id,
      household_id,
      catalog_key: op.catalog_key ?? null,
      label: op.label,
      zone: (op.zone ?? 'dry') as Zone,
      value: op.value ?? null,
      unit: (op.unit ?? null) as Unit | null,
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
    if (op.value !== undefined) patch.value = op.value;
    if (op.unit !== undefined) patch.unit = op.unit;
    if (op.zone !== undefined) patch.zone = op.zone;
    await repo.updateBatch(target.id, patch);
  }
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

  await repo.updatePending(pc.id, { undone_at: new Date().toISOString() });
  return { undone: true, already: false };
}
