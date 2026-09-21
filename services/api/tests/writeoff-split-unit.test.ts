// Партії v2 (spec 2026-09-21-shelf-life-v2-design.md, PR 2): списання з ШТУЧНОЇ
// партії у грамах відділяє одиницю — (N−1) запечатані лишаються, 1 відкрита з
// залишком; далі береться з відкритого залишку; «open» на всю партію більше нема.
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryRepo, createPending, applyCard, type PantryBatch, type IntakeOp } from '@kitchen/domain';
import { buildWriteoffOps } from '../src/post-cook.js';

describe('buildWriteoffOps · штучне у грамах', () => {
  let repo: InMemoryRepo; const h = randomUUID(); const u = randomUUID();
  let productId: string;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    productId = randomUUID();
    await repo.insertProduct({ id: productId, household_id: h, product: 'спагеті', brand: 'Barilla', variant: null, unit: 'g', pack_size: 400, tags: {}, catalog_key: null, created_at: new Date().toISOString() });
  });
  const seed = async (over: Partial<PantryBatch> = {}) => {
    const id = randomUUID();
    await repo.insertBatch({ id, household_id: h, catalog_key: null, label: 'спагеті Barilla', zone: 'dry', value: 4, unit: 'pcs', state: 'sealed', opened_at: null, expires_at: null, best_before_opened_days: null, added_at: new Date().toISOString(), depleted_at: null, confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: 'add', product_id: productId, ...over });
    return id;
  };
  const run = async (ops: IntakeOp[]) => {
    const message_id = randomUUID();
    await createPending(repo, { message_id, household_id: h, user_id: u, card: { type: 'intake_diff', ops } });
    await applyCard(repo, message_id, [], u);
  };
  const live = async () => (await repo.listBatches(h)).filter((b) => !b.depleted_at).sort((a, b) => a.state.localeCompare(b.state));

  it('(а) 4 шт × 400 г − 200 г → 3 зап (sealed) + 1 відкрита 200 г', async () => {
    const id = await seed();
    const ops = await buildWriteoffOps(repo, h, { t: 'Паста', sv: 2, ing: [{ p: id, n: 'спагеті', v: 200, u: 'g' }], st: [] } as never);
    expect(ops).toEqual([
      { op: 'correct', label: 'спагеті Barilla', batch_id: id, value: 3, unit: 'pcs' },
      expect.objectContaining({ op: 'add', label: 'спагеті Barilla', state: 'opened', value: 200, unit: 'g', product: 'спагеті', brand: 'Barilla' }),
    ]);
    await run(ops);
    const bs = await live();
    expect(bs.map((b) => [b.state, b.value, b.unit])).toEqual([['opened', 200, 'g'], ['sealed', 3, 'pcs']]);
    expect(bs.find((b) => b.state === 'sealed')!.opened_at).toBeNull();
  });

  it('ланцюжок: −200, потім −300 → з відкритої 200 усе, з нової одиниці 100 → 2 зап + 1 відкрита 300', async () => {
    const id = await seed();
    await run(await buildWriteoffOps(repo, h, { t: 'x', sv: 2, ing: [{ p: id, n: 'спагеті', v: 200, u: 'g' }], st: [] } as never));
    const ops2 = await buildWriteoffOps(repo, h, { t: 'x', sv: 2, ing: [{ p: id, n: 'спагеті', v: 300, u: 'g' }], st: [] } as never);
    expect(ops2.map((o) => o.op)).toEqual(['deplete', 'correct', 'add']);   // відкритий залишок 200 → геть; 3 → 2; нова відкрита 300
    await run(ops2);
    expect((await live()).map((b) => [b.state, b.value, b.unit])).toEqual([['opened', 300, 'g'], ['sealed', 2, 'pcs']]);
  });

  it('відкритого залишку вистачає: −150 при відкритій 200 → лише correct 50, запечатані не чіпаються', async () => {
    const id = await seed();
    await run(await buildWriteoffOps(repo, h, { t: 'x', sv: 2, ing: [{ p: id, n: 'спагеті', v: 200, u: 'g' }], st: [] } as never));
    const ops = await buildWriteoffOps(repo, h, { t: 'x', sv: 2, ing: [{ p: id, n: 'спагеті', v: 150, u: 'g' }], st: [] } as never);
    expect(ops).toHaveLength(1); expect(ops[0]).toMatchObject({ op: 'correct', value: 50, unit: 'g' });
  });

  it('вага одиниці невідома (нема pack_size і каталогу) → (N−1) зап + 1 відкрита із залишком null', async () => {
    const p2 = randomUUID();
    await repo.insertProduct({ id: p2, household_id: h, product: 'квасоля', brand: null, variant: null, unit: null, pack_size: null, tags: {}, catalog_key: null, created_at: new Date().toISOString() });
    const id = await seed({ label: 'квасоля', product_id: p2, value: 2 });
    const ops = await buildWriteoffOps(repo, h, { t: 'x', sv: 2, ing: [{ p: id, n: 'квасоля', v: 150, u: 'g' }], st: [] } as never);
    expect(ops[0]).toMatchObject({ op: 'correct', value: 1, unit: 'pcs' });
    expect(ops[1]).toMatchObject({ op: 'add', state: 'opened' });
    expect((ops[1] as { value?: number }).value).toBeUndefined();
    await run(ops);
    expect((await live()).map((b) => [b.state, b.value])).toEqual([['opened', null], ['sealed', 1]]);
  });

  it('(г) остання одиниця вжита цілком (1 шт × 400 − 400) → deplete, без відкритого залишку; більше за партію — теж deplete', async () => {
    const id = await seed({ value: 1 });
    expect(await buildWriteoffOps(repo, h, { t: 'x', sv: 2, ing: [{ p: id, n: 'спагеті', v: 400, u: 'g' }], st: [] } as never)).toEqual([{ op: 'deplete', label: 'спагеті Barilla', batch_id: id }]);
  });

  it('(б) вагова партія — як досі: correct на залишок, партія відкривається цілком', async () => {
    const id = await seed({ label: 'сало', value: 1000, unit: 'g', product_id: null });
    const ops = await buildWriteoffOps(repo, h, { t: 'x', sv: 2, ing: [{ p: id, n: 'сало', v: 300, u: 'g' }], st: [] } as never);
    expect(ops).toEqual([{ op: 'correct', label: 'сало', batch_id: id, value: 700, unit: 'g' }]);
    await run(ops);
    const b = await repo.getBatch(id);
    expect(b!.state).toBe('opened'); expect(b!.value).toBe(700);
  });

  it('штучне без числа в рецепті (u нема) — open, як було', async () => {
    const id = await seed();
    expect(await buildWriteoffOps(repo, h, { t: 'x', sv: 2, ing: [{ p: id, n: 'спагеті' }], st: [] } as never)).toEqual([{ op: 'open', label: 'спагеті Barilla', batch_id: id }]);
  });
});
