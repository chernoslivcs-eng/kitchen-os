// 01.09 рівень 1: findBatch і так повертає candidates по кожному пошуку
// (інші смаки/фасування), раніше просто відкидались. Хіт-рядок (товар уже
// в кошику мережі) отримує їх ІНФОРМАЦІЙНО — без тапу-заміни, бо наша
// інтеграція вміє лише addToCart, без видалення з живого кошика; тап-заміна
// на хіті задвоїла б позицію. Проміс-рядок (нічого ще не додано) лишає
// candidates як кнопки заміни, як і раніше, просто тепер їх може бути кілька.

import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

function schweppes(id: string, name: string, price: number) {
  return {
    id, name, slug: id, price, oldPrice: null,
    stock: true, available: true, weighted: false, step: 1, companyId: 'c1', branchId: 'b1',
  };
}

describe('retail: інші варіанти того самого пошуку (candidates)', () => {
  it('хіт з кількома кандидатами — alternatives інформаційні, вибраний товар виключений', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const found = [
      schweppes('id-tonic', 'Напій Schweppes Indian Tonic', 33),
      schweppes('id-pink', 'Напій Schweppes Pink Tonic', 33),
      schweppes('id-bitter', 'Напій Schweppes Bitter Lemon', 35),
    ];
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
    expect(row.product).toMatchObject({ name: 'Напій Schweppes Indian Tonic' });
    expect(row.alternatives).toHaveLength(2);
    expect(row.alternatives.map((a: { name: string }) => a.name)).toEqual([
      'Напій Schweppes Pink Tonic', 'Напій Schweppes Bitter Lemon',
    ]);
    // Вибраний товар не дублюється в переліку "ще є".
    expect(row.alternatives.some((a: { name: string }) => a.name === 'Напій Schweppes Indian Tonic')).toBe(false);
  });

  it('кандидатів більше за ліміт (10) — картка обрізає, не роздувається', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const found = Array.from({ length: 14 }, (_, i) => schweppes(`id-${i}`, `Смак ${i}`, 30 + i));
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
    // 14 кандидатів мінус вибраний (13) — обрізано до 10.
    expect(row.alternatives).toHaveLength(10);
  });

  it('cart-swap на хіт-рядку (товар уже доданий) — 409 already_matched, addToCart вдруге не викликається', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const found = [schweppes('id-tonic', 'Напій Schweppes Indian Tonic', 33), schweppes('id-pink', 'Напій Schweppes Pink Tonic', 33)];
    const cartAdds: Array<{ productId: string }> = [];
    const app = buildApp(repo, new InMemoryStore(), mailer, {
      retail: {
        silpo: {
          clientId: 'c', tokenSecret: 's', devAccessToken: 'dev-token',
          makeProvider: () => ({
            receipts: async () => [],
            findBatch: async (queries: string[]) => queries.map((q) => ({ query: q, candidates: found, product: found[0] ?? null })),
            addToCart: async (items: Array<{ productId: string }>) => { cartAdds.push(...items); },
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
    const build = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/build-cart', headers: { cookie: me.cookie },
    });
    const { card_id } = build.json();
    expect(cartAdds).toHaveLength(1);

    const swap = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/cart-swap', headers: { cookie: me.cookie },
      payload: { card_id, row_index: 0, alt_index: 0 },
    });
    expect(swap.statusCode).toBe(409);
    expect(swap.json().error).toBe('already_matched');
    expect(cartAdds).toHaveLength(1);
  });
});
