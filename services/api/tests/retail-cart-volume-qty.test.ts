// 01.09 issue A, живий репро від самого початку сесії: «хочу замовити
// швепс в сільпо 1 літр» на пляшку 0,33 л давало 1 шт (≈0.33 л), мовчки.
// qtyFor() рахувала кількість тільки для вагового (кг); обсягове завжди
// падало в гілку «штучне» — 1 шт, незалежно від заявленого обсягу.

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

describe('retail: обсягове рахує кількість пляшок від заявленого обсягу', () => {
  it('«1 літр» на пляшку 0,33 л → 4 шт (≥1л), не мовчазна 1 шт', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const found = [product('id-tonic', 'Schweppes Pink Tonic, скло 0,33 л', 33)];
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
    // v/u — так само, як модель мала б заповнити на «хочу літр швепса».
    await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie },
      payload: { label: 'швепс', v: 1000, u: 'ml' },
    });

    const r = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/build-cart', headers: { cookie: me.cookie },
    });
    const row = r.json().card.rows[0];
    // ceil(1000/330) = 4 — 3 пляшки (990мл) не покрили б заявлений літр.
    expect(row.product.quantity).toBe(4);
    expect(row.product.package_ml).toBe(330);
    expect(cartAdds).toEqual([{ productId: 'id-tonic', companyId: 'c1', branchId: 'b1', quantity: 4 }]);
  });

  it('«2 літри» з чату (u:"l", НЕ "ml" — так модель і пише за card-rules.md) → рахує пляшки', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const found = [product('id-schweppes', 'Напій соковмісний Schweppes Classic Mojito, 0,33 л', 33)];
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
    // Точно те, що applyShoppingOp кладе для «додай швепс 2 літри у список»
    // (card-rules.md: «Постав два літри молока» → {"v":2,"u":"l"}) — літри,
    // НЕ мілілітри, без конвертації на шляху shopping.
    await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie },
      payload: { label: 'швепс', v: 2, u: 'l' },
    });

    const r = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/build-cart', headers: { cookie: me.cookie },
    });
    const row = r.json().card.rows[0];
    // ceil(2000/330) = 7 — 6 банок (1980мл) не покрили б заявлені 2л.
    expect(row.product.quantity).toBe(7);
    expect(row.product.package_ml).toBe(330);
    expect(cartAdds).toEqual([{ productId: 'id-schweppes', companyId: 'c1', branchId: 'b1', quantity: 7 }]);
  });

  it('без заявленого обсягу — package_ml все одно розпізнається (для видимої математики), кількість лишається 1', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const found = [product('id-tonic', 'Schweppes Pink Tonic, скло 0,33 л', 33)];
    const app = buildApp(repo, new InMemoryStore(), mailer, {
      retail: {
        silpo: {
          clientId: 'c', tokenSecret: 's', devAccessToken: 'dev-token',
          makeProvider: () => ({
            receipts: async () => [],
            findBatch: async (queries: string[]) => queries.map((q) => ({ query: q, candidates: found, product: found[0] ?? null })),
            addToCart: async () => {},
          }),
        },
      },
    });
    await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie }, payload: { label: 'швепс' },
    });

    const r = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/build-cart', headers: { cookie: me.cookie },
    });
    const row = r.json().card.rows[0];
    expect(row.product.quantity).toBe(1);
    expect(row.product.package_ml).toBe(330);
  });

  it('штучний товар без обсягу в назві — package_ml null, не ламається', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const found = [product('id-rice', 'Рис круглий', 40)];
    const app = buildApp(repo, new InMemoryStore(), mailer, {
      retail: {
        silpo: {
          clientId: 'c', tokenSecret: 's', devAccessToken: 'dev-token',
          makeProvider: () => ({
            receipts: async () => [],
            findBatch: async (queries: string[]) => queries.map((q) => ({ query: q, candidates: found, product: found[0] ?? null })),
            addToCart: async () => {},
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

    const r = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/build-cart', headers: { cookie: me.cookie },
    });
    const row = r.json().card.rows[0];
    expect(row.product.quantity).toBe(1);
    expect(row.product.package_ml).toBeNull();
  });
});
