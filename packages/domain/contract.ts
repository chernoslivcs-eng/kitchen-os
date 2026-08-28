// Спільний контракт для будь-якої реалізації Repo.
// Викликається з тестів InMemoryRepo і PostgresRepo — гарантує, що обидві дають
// однакову семантику. Дрейф між реалізаціями — категорія помилок, яку ловимо тут.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Repo } from './repo.js';
import type { PantryBatch, IntakeCard } from './types.js';
import { createPending, applyCard, undoCard } from './apply.js';

export interface RepoCtx {
  repo: Repo;
  household_id: string;
  user_id: string;
}

export interface RepoFactory {
  make(): Promise<RepoCtx>;   // викликається у beforeEach — має віддавати чистий стан
  teardown?(): Promise<void>; // викликається у afterAll — закрити пул/контейнер
}

async function seedFarsh(
  repo: Repo,
  household_id: string,
  label = 'Яловично-свинячий фарш',
): Promise<PantryBatch> {
  const b: PantryBatch = {
    id: randomUUID(),
    household_id,
    catalog_key: null,   // FK у PG порожня, щоб не тягнути каталог у контрактні тести
    label,
    zone: 'fridge',
    value: 500,
    unit: 'g',
    state: 'sealed',
    opened_at: null,
    expires_at: null,
    best_before_opened_days: 3,
    added_at: new Date().toISOString(),
    depleted_at: null,
    confidence: 1,
    provenance: 'user_statement',
    staple: false,
    last_by: null,
    last_action: 'add',
  };
  await repo.insertBatch(b);
  return b;
}

export function describeRepoContract(name: string, factory: RepoFactory) {
  describe(name, () => {
    let ctx: RepoCtx;
    beforeEach(async () => { ctx = await factory.make(); });
    afterAll(async () => { await factory.teardown?.(); });

    it('add: створює нову партію, undo її видаляє', async () => {
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [
        { op: 'add', label: 'Моцарела', value: 250, unit: 'g', zone: 'fridge', confidence: 0.9, evidence: 'receipt_line' },
      ]};
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      const { applied, undo_token } = await applyCard(ctx.repo, mid, [], ctx.user_id);
      expect(applied).toBe(1);

      const batches = await ctx.repo.listBatches(ctx.household_id);
      expect(batches).toHaveLength(1);
      expect(batches[0]!.label).toBe('Моцарела');

      const res = await undoCard(ctx.repo, mid, undo_token, ctx.user_id);
      expect(res.undone).toBe(true);
      expect(await ctx.repo.listBatches(ctx.household_id)).toHaveLength(0);
    });

    it('deplete: знаходить партію за назвою й ставить depleted', async () => {
      const seeded = await seedFarsh(ctx.repo, ctx.household_id);
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'deplete', label: 'фарш' }] };
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      await applyCard(ctx.repo, mid, [], ctx.user_id);

      const b = await ctx.repo.getBatch(seeded.id);
      expect(b?.state).toBe('depleted');
      expect(b?.depleted_at).not.toBeNull();
    });

    it('open: ставить opened_at і термін від best_before_opened_days', async () => {
      const seeded = await seedFarsh(ctx.repo, ctx.household_id);
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'open', label: 'фарш' }] };
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      await applyCard(ctx.repo, mid, [], ctx.user_id);

      const b = await ctx.repo.getBatch(seeded.id);
      expect(b?.state).toBe('opened');
      expect(b?.opened_at).not.toBeNull();
      expect(b?.expires_at).not.toBeNull();
    });

    it('rename: змінює label, undo повертає', async () => {
      const seeded = await seedFarsh(ctx.repo, ctx.household_id, 'Крем-брусок');
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'rename', label: 'Крем-брусок', to: 'Крем-брюле Pont' }] };
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      const { undo_token } = await applyCard(ctx.repo, mid, [], ctx.user_id);
      expect((await ctx.repo.getBatch(seeded.id))?.label).toBe('Крем-брюле Pont');

      await undoCard(ctx.repo, mid, undo_token, ctx.user_id);
      expect((await ctx.repo.getBatch(seeded.id))?.label).toBe('Крем-брусок');
    });

    it('correct: змінює вагу; повторний apply з тим самим id — no-op (ідемпотентно)', async () => {
      const seeded = await seedFarsh(ctx.repo, ctx.household_id);
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'correct', label: 'фарш', value: 400, unit: 'g' }] };
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      const r1 = await applyCard(ctx.repo, mid, [], ctx.user_id);
      expect((await ctx.repo.getBatch(seeded.id))?.value).toBe(400);
      expect(r1.already).toBe(false);

      const r2 = await applyCard(ctx.repo, mid, [], ctx.user_id);
      expect(r2.already).toBe(true);
      expect(r2.undo_token).toBe(r1.undo_token);
      expect((await ctx.repo.getBatch(seeded.id))?.value).toBe(400);
    });

    it('deplete на неіснуючу назву: тихий no-op (модель НЕ пише в стан напряму)', async () => {
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'deplete', label: 'ковбаса, якої нема' }] };
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      const { applied } = await applyCard(ctx.repo, mid, [], ctx.user_id);
      expect(applied).toBe(1);
      expect(await ctx.repo.listBatches(ctx.household_id)).toHaveLength(0);
    });

    it('чужий актор — forbidden', async () => {
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'add', label: 'x' }] };
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      await expect(applyCard(ctx.repo, mid, [], randomUUID())).rejects.toThrow(/forbidden/);
    });

    it('undo з неправильним токеном — помилка; повторний undo — no-op', async () => {
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'add', label: 'x' }] };
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      const { undo_token } = await applyCard(ctx.repo, mid, [], ctx.user_id);
      await expect(undoCard(ctx.repo, mid, randomUUID(), ctx.user_id)).rejects.toThrow(/mismatch/);
      const r1 = await undoCard(ctx.repo, mid, undo_token, ctx.user_id);
      expect(r1.undone).toBe(true);
      const r2 = await undoCard(ctx.repo, mid, undo_token, ctx.user_id);
      expect(r2.already).toBe(true);
    });
  });
}
