// 01.09 картка v2: степер кількості на рядку кошика до «Оформити в
// Сільпо» — потребує серверного перерахунку ціни й повторного addToCart
// із новою кількістю (Сільпо-інструмент сам «add or update», той самий
// productId просто оновлює кількість, не дублює).

import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

function product(id: string, name: string, price: number) {
  return {
    id, name, slug: id, price, oldPrice: null,
    stock: true, available: true, weighted: false, step: 1, companyId: 'c1', branchId: 'b1',
  };
}

describe('retail: cart-update-qty — степер міняє кількість, ціна перераховується', () => {
  it('змінює кількість, addToCart летить з новим числом, total перераховано', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const found = [product('id-rice', 'Рис круглий', 40)];
    const cartAdds: { productId: string; quantity: number }[] = [];
    const app = buildApp(repo, new InMemoryStore(), mailer, {
      retail: {
        silpo: {
          clientId: 'c', tokenSecret: 's', devAccessToken: 'dev-token',
          makeProvider: () => ({
            receipts: async () => [],
            findBatch: async (queries: string[]) => queries.map((q) => ({ query: q, candidates: found, product: found[0] ?? null })),
            addToCart: async (items: { productId: string; quantity: number }[]) => { cartAdds.push(...items); },
          }),
        },
      },
    });
    await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie }, payload: { label: 'рис' },
    });
    const build = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/build-cart', headers: { cookie: me.cookie },
    });
    const { card_id } = build.json();
    expect(cartAdds).toEqual([{ productId: 'id-rice', companyId: 'c1', branchId: 'b1', quantity: 1 }]);

    const upd = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/cart-update-qty', headers: { cookie: me.cookie },
      payload: { card_id, row_index: 0, quantity: 3 },
    });
    expect(upd.statusCode).toBe(200);
    const card = upd.json().card;
    expect(card.rows[0].product.quantity).toBe(3);
    expect(card.total).toBe(120); // 40₴ × 3
    expect(cartAdds.at(-1)).toEqual({ productId: 'id-rice', companyId: 'c1', branchId: 'b1', quantity: 3 });
  });

  it('вагове округлюється до кроку 0.1, мінімум 0.1', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const weighted = {
      id: 'id-fish', name: 'Лосось охолоджений', slug: 'fish', price: 400, oldPrice: null,
      stock: true, available: true, weighted: true, step: 1, companyId: 'c1', branchId: 'b1',
    };
    const app = buildApp(repo, new InMemoryStore(), mailer, {
      retail: {
        silpo: {
          clientId: 'c', tokenSecret: 's', devAccessToken: 'dev-token',
          makeProvider: () => ({
            receipts: async () => [],
            findBatch: async (queries: string[]) => queries.map((q) => ({ query: q, candidates: [weighted], product: weighted })),
            addToCart: async () => {},
          }),
        },
      },
    });
    await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie }, payload: { label: 'лосось', v: 300, u: 'g' },
    });
    const build = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/build-cart', headers: { cookie: me.cookie },
    });
    const { card_id } = build.json();

    const upd = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/cart-update-qty', headers: { cookie: me.cookie },
      payload: { card_id, row_index: 0, quantity: 0.03 },
    });
    const card = upd.json().card;
    expect(card.rows[0].product.quantity).toBe(0.1);
  });

  it('рядок без товару (проміс) — 409, нічого не міняється', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const app = buildApp(repo, new InMemoryStore(), mailer, {
      retail: {
        silpo: {
          clientId: 'c', tokenSecret: 's', devAccessToken: 'dev-token',
          makeProvider: () => ({
            receipts: async () => [],
            findBatch: async (queries: string[]) => queries.map((q) => ({ query: q, candidates: [], product: null })),
            addToCart: async () => {},
          }),
        },
      },
    });
    await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie }, payload: { label: 'щось дивне' },
    });
    const build = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/build-cart', headers: { cookie: me.cookie },
    });
    const { card_id } = build.json();

    const upd = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/cart-update-qty', headers: { cookie: me.cookie },
      payload: { card_id, row_index: 0, quantity: 3 },
    });
    expect(upd.statusCode).toBe(409);
  });
});
