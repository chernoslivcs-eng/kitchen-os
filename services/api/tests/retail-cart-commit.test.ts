// 21.09 (рішення власника): картка кошика — ЧЕРНЕТКА. «Зібрати» лише шукає;
// заміна/кількість правлять картку без мережі; у Сільпо все їде ОДНИМ пакетом
// по POST /v1/retail/cart/commit. Ідемпотентно; часткова невдача → failed;
// після commit правки заблоковані (409 cart_committed).
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

const product = (id: string, name: string, price: number, weighted = false) => ({
  id, name, slug: id, price, oldPrice: null, stock: true, available: true, weighted, step: 1, companyId: 'c1', branchId: 'b1',
});
type Add = { productId: string; quantity: number };

async function stand(opts: { failFor?: string[]; failBatch?: boolean } = {}) {
  const repo = new InMemoryRepo(); const mailer = new ConsoleMailer();
  const cartAdds: Add[][] = [];
  const catalog: Record<string, ReturnType<typeof product>[]> = {
    рис: [product('id-rice', 'Рис круглий', 40), product('id-basmati', 'Рис басматі', 90)],
    лосось: [product('id-salmon', 'Лосось стейк', 500, true)],
    кунжут: [],
  };
  const app = buildApp(repo, new InMemoryStore(), mailer, {
    retail: { silpo: { clientId: 'c', tokenSecret: 's', devAccessToken: 'dev-token', makeProvider: () => ({
      receipts: async () => [],
      findBatch: async (queries: string[]) => queries.map((q) => ({ query: q, candidates: catalog[q] ?? [], product: catalog[q]?.[0] ?? null })),
      addToCart: async (items: Add[]) => {
        if (opts.failBatch && items.length > 1) throw new Error('batch rejected');
        if (items.some((i) => opts.failFor?.includes(i.productId))) throw new Error('rejected');
        cartAdds.push(items);
      },
    }) } },
  });
  await app.ready();
  const me = await signIn(app, mailer, 'me@example.com');
  await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
  for (const label of ['рис', 'лосось', 'кунжут']) await app.inject({ method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie }, payload: { label, ...(label === 'лосось' ? { v: 300, u: 'g' } : {}) } });
  const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: { cookie: me.cookie }, payload });
  return { repo, app, me, cartAdds, post };
}

describe('кошик Сільпо як чернетка + commit', () => {
  it('build → жодного addToCart, committed:false; commit → усі rows з product одним пакетом (кількість/вагове як у чернетці), committed:true', async () => {
    const { cartAdds, post } = await stand();
    const build = (await post('/v1/retail/silpo/build-cart', {})).json();
    expect(build.card).toMatchObject({ committed: false, found: 2, of: 3 });
    expect(cartAdds).toEqual([]);
    const c = await post('/v1/retail/cart/commit', { card_id: build.card_id });
    expect(c.statusCode).toBe(200);
    expect(c.json()).toMatchObject({ ok: true, failed: [] });
    expect(c.json().card.committed).toBe(true);
    expect(c.json().card.committed_at).toBeTruthy();
    expect(cartAdds).toHaveLength(1);                                  // один пакет
    expect(cartAdds[0]).toEqual([
      { productId: 'id-rice', companyId: 'c1', branchId: 'b1', quantity: 1 },
      { productId: 'id-salmon', companyId: 'c1', branchId: 'b1', quantity: 0.3 },
    ]);
  });

  it('swap і qty на чернетці — без мережі; після commit — 409 cart_committed', async () => {
    const { cartAdds, post } = await stand();
    const { card_id } = (await post('/v1/retail/silpo/build-cart', {})).json();
    expect((await post('/v1/retail/silpo/cart-swap', { card_id, row_index: 0, alt_index: 0 })).json().card.rows[0].product.product_id).toBe('id-basmati');
    expect((await post('/v1/retail/silpo/cart-update-qty', { card_id, row_index: 0, quantity: 2 })).json().card.rows[0].product.quantity).toBe(2);
    expect(cartAdds).toEqual([]);
    await post('/v1/retail/cart/commit', { card_id });
    expect(cartAdds[0]![0]).toMatchObject({ productId: 'id-basmati', quantity: 2 });
    for (const [url, body] of [
      ['/v1/retail/silpo/cart-swap', { card_id, row_index: 0, alt_index: 0 }],
      ['/v1/retail/silpo/cart-update-qty', { card_id, row_index: 0, quantity: 3 }],
      ['/v1/retail/silpo/cart-add-alt', { card_id, row_index: 0, alt_index: 0 }],
    ] as const) {
      const r = await post(url, body);
      expect(r.statusCode, url).toBe(409);
      expect(r.json().error).toBe('cart_committed');
    }
    expect(cartAdds).toHaveLength(1);
  });

  it('ідемпотентно: повторний commit нічого не додає, повертає ok і already', async () => {
    const { cartAdds, post } = await stand();
    const { card_id } = (await post('/v1/retail/silpo/build-cart', {})).json();
    await post('/v1/retail/cart/commit', { card_id });
    const again = await post('/v1/retail/cart/commit', { card_id });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ ok: true, already: true });
    expect(cartAdds).toHaveLength(1);
  });

  it('часткова невдача: пакет відбито → по одному; failed = label-и, решта поїхала, картка committed із failed', async () => {
    const { cartAdds, post, repo } = await stand({ failBatch: true, failFor: ['id-salmon'] });
    const { card_id } = (await post('/v1/retail/silpo/build-cart', {})).json();
    const c = await post('/v1/retail/cart/commit', { card_id });
    expect(c.statusCode).toBe(200);
    expect(c.json().failed).toEqual(['лосось']);
    expect(cartAdds.flat().map((a) => a.productId)).toEqual(['id-rice']);
    const saved = (await repo.getMessage(card_id))?.card as { committed?: boolean; failed?: string[] };
    expect(saved).toMatchObject({ committed: true, failed: ['лосось'] });
  });

  it('без card_id — 400; невідома картка — 404', async () => {
    const { post } = await stand();
    expect((await post('/v1/retail/cart/commit', {})).statusCode).toBe(400);
    expect((await post('/v1/retail/cart/commit', { card_id: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404);
  });
});
