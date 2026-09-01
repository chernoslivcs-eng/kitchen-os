// 01.09 рівень 1: findBatch і так повертає candidates по кожному пошуку
// (інші смаки/фасування), раніше просто відкидались. Обидва типи рядків —
// хіт (товар уже в кошику мережі) і проміс — тепер дають candidates як
// кнопки: «замінити» (тап на хіті теж дозволений, з попередженням у UI —
// наша інтеграція вміє тільки addToCart, без видалення) і «додати окремо»
// (нова позиція в кошику, оригінальний рядок не чіпається).

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

  // 01.09 рефінемент після живого тесту: людина явно попросила тап-заміну
  // і на хіт-рядку теж («переключити позицію, яку запропонував ЛЛМ») —
  // погодились на «заміна + попередження» в UI замість блокування на
  // сервері. Стара позиція технічно може лишитись у живому кошику
  // Сільпо (addToCart без видалення) — це вже відповідальність UI-копі,
  // не сервера.
  it('cart-swap на хіт-рядку (товар уже доданий) — тепер дозволено, addToCart летить за новим товаром', async () => {
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
    expect(swap.statusCode).toBe(200);
    expect(cartAdds.map((a) => a.productId)).toEqual(['id-tonic', 'id-pink']);
    const row = swap.json().card.rows[0];
    expect(row.product).toMatchObject({ name: 'Напій Schweppes Pink Tonic' });
    // Обраний варіант зникає зі списку "ще є" — решта лишається.
    expect(row.alternatives).toEqual([]);
  });

  // 01.09 живий кейс: «замовляю літр швепса, і раптом бачу банановий
  // швепс серед альтернатив — хочу замовити ще й його». Це НЕ заміна:
  // оригінальна позиція лишається, з'являється НОВИЙ рядок.
  it('cart-add-alt: додає альтернативу окремим рядком, оригінал не чіпає', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const found = [schweppes('id-tonic', 'Напій Schweppes Indian Tonic', 33), schweppes('id-banana', 'Напій Schweppes Banana', 29)];
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

    const add = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/cart-add-alt', headers: { cookie: me.cookie },
      payload: { card_id, row_index: 0, alt_index: 0 },
    });
    expect(add.statusCode).toBe(200);
    expect(cartAdds.map((a) => a.productId)).toEqual(['id-tonic', 'id-banana']);
    const card = add.json().card;
    expect(card.rows).toHaveLength(2);
    // Оригінал НЕ змінився.
    expect(card.rows[0].product).toMatchObject({ name: 'Напій Schweppes Indian Tonic' });
    // Новий рядок — банановий Швепс, доданий окремо.
    expect(card.rows[1].product).toMatchObject({ name: 'Напій Schweppes Banana' });
    // Обраний варіант зникає зі списку "ще є" оригінального рядка.
    expect(card.rows[0].alternatives).toEqual([]);
    expect(card.found).toBe(2);
    expect(card.total).toBe(62);
  });
});
