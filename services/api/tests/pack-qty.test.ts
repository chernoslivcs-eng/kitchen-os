// Упаковане (строки v2, PR 4): add з qty + pack → партія в штуках, вага одиниці на
// продукті (лише коли порожня); списання зі штучної партії бере вагу звідти;
// PATCH /v1/products/:id — вага одиниці руками.
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, createPending, applyCard, type IntakeCard } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { buildWriteoffOps } from '../src/post-cook.js';

describe('упаковане: qty + pack', () => {
  let repo: InMemoryRepo; let app: ReturnType<typeof buildApp>; let mailer: ConsoleMailer;
  beforeEach(async () => { repo = new InMemoryRepo(); mailer = new ConsoleMailer(); app = buildApp(repo, new InMemoryStore(), mailer); await app.ready(); });
  const apply = async (h: string, u: string, card: IntakeCard) => {
    const message_id = randomUUID();
    await createPending(repo, { message_id, household_id: h, user_id: u, card });
    return applyCard(repo, message_id, [], u);
  };

  it('add з qty 4 + pack 400 g → партія 4 pcs, product.pack_size 400 g; повторний add з іншим pack не перетирає', async () => {
    const me = await signIn(app, mailer, 'p1@example.com');
    await apply(me.household_id, me.user_id, { type: 'intake_diff', ops: [{ op: 'add', label: 'томати пелаті', product: 'томати пелаті', brand: 'Metro Chef', qty: 4, pack: { v: 400, u: 'g' }, zone: 'dry' }] });
    const [b] = await repo.listBatches(me.household_id);
    expect(b).toMatchObject({ value: 4, unit: 'pcs', state: 'sealed', zone: 'dry' });
    const prod = await repo.getProduct(b!.product_id!);
    expect(prod).toMatchObject({ pack_size: 400, pack_unit: 'g' });
    // вчорашня партія, щоб не злилась (той самий продукт, день, стан)
    await repo.updateBatch(b!.id, { added_at: new Date(Date.now() - 86_400_000).toISOString() });
    await apply(me.household_id, me.user_id, { type: 'intake_diff', ops: [{ op: 'add', label: 'томати пелаті', product: 'томати пелаті', brand: 'Metro Chef', qty: 2, pack: { v: 800, u: 'g' } }] });
    expect(await repo.getProduct(b!.product_id!)).toMatchObject({ pack_size: 400, pack_unit: 'g' });
    expect((await repo.listBatches(me.household_id)).map((x) => x.value)).toEqual([4, 2]);
  });

  it('чат-картка з qty/pack (стаб «купив …» не дає pack — картка з ops напряму через /v1/cards apply)', async () => {
    const me = await signIn(app, mailer, 'p2@example.com');
    const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'add', label: 'вино', product: 'вино', qty: 1, pack: { v: 750, u: 'ml' }, zone: 'drinks' }] };
    await apply(me.household_id, me.user_id, card);
    const [b] = await repo.listBatches(me.household_id);
    expect(b).toMatchObject({ value: 1, unit: 'pcs' });
    expect(await repo.getProduct(b!.product_id!)).toMatchObject({ pack_size: 750, pack_unit: 'ml' });
    expect((card.ops[0] as { batch_id?: string }).batch_id).toBe(b!.id);
  });

  it('списання 200 г із «4 × pack 400» → 3 зап + відкрита 200 — вага з pack_size продукту, не з каталогу', async () => {
    const me = await signIn(app, mailer, 'p3@example.com');
    await apply(me.household_id, me.user_id, { type: 'intake_diff', ops: [{ op: 'add', label: 'квасоля біла консервована', product: 'квасоля біла консервована', qty: 4, pack: { v: 400, u: 'g' } }] });
    const [b] = await repo.listBatches(me.household_id);
    const ops = await buildWriteoffOps(repo, me.household_id, { t: 'x', sv: 2, ing: [{ p: b!.id, n: 'квасоля', v: 200, u: 'g' }], st: [] } as never);
    expect(ops).toEqual([
      { op: 'correct', label: b!.label, batch_id: b!.id, value: 3, unit: 'pcs' },
      expect.objectContaining({ op: 'add', state: 'opened', value: 200, unit: 'g' }),
    ]);
  });

  it('PATCH /v1/products/:id — вага одиниці руками; 400 без pack_size; null — прибрати; чужий — 404', async () => {
    const me = await signIn(app, mailer, 'p4@example.com');
    await apply(me.household_id, me.user_id, { type: 'intake_diff', ops: [{ op: 'add', label: 'тунець', product: 'тунець', qty: 2 }] });
    const [b] = await repo.listBatches(me.household_id);
    const pid = b!.product_id!;
    expect((await repo.getProduct(pid))!.pack_size).toBeNull();
    const r = await app.inject({ method: 'PATCH', url: `/v1/products/${pid}`, headers: { cookie: me.cookie }, payload: { pack_size: 185 } });
    expect(r.statusCode).toBe(200);
    expect(r.json().product).toMatchObject({ pack_size: 185, pack_unit: 'g' });
    expect((await repo.getProduct(pid))).toMatchObject({ pack_size: 185, pack_unit: 'g' });
    expect((await app.inject({ method: 'PATCH', url: `/v1/products/${pid}`, headers: { cookie: me.cookie }, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/v1/products/${pid}`, headers: { cookie: me.cookie }, payload: { pack_size: null } })).json().product.pack_size).toBeNull();
    const other = await signIn(app, mailer, 'p5@example.com');
    expect((await app.inject({ method: 'PATCH', url: `/v1/products/${pid}`, headers: { cookie: other.cookie }, payload: { pack_size: 1 } })).statusCode).toBe(404);
  });
});
