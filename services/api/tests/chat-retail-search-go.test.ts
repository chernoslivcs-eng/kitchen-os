// 01.09 живий кейс: «а які ще опції в Сільпо є по швепсу?» — це питання про
// наявність, НЕ замовлення (cart_go) і НЕ список покупок (shopping). Модель
// маркує намір карткою retail_search_go (query дослівно), сервер шукає
// живцем і формує репліку з реальних даних текстом — без жодної картки,
// нічого не додається ні в кошик мережі, ні в список покупок.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';

function product(id: string, name: string, price: number) {
  return {
    id, name, slug: id, price, oldPrice: null,
    stock: true, available: true, weighted: false, step: 1, companyId: 'c1', branchId: 'b1',
  };
}

describe('чат: retail_search_go → живий пошук наявності текстом, без картки', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let me: Signed;
  let cartAdds: unknown[];

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    cartAdds = [];
    const found = [
      product('id-1', 'Напій Schweppes Indian Tonic', 33),
      product('id-2', 'Напій Schweppes Pink Tonic', 34),
      product('id-3', 'Вино Шенін Блан', 249), // алкоголь — має відсіятись
    ];
    app = buildApp(repo, new InMemoryStore(), mailer, {
      retail: {
        silpo: {
          clientId: 'c', tokenSecret: 's', devAccessToken: 'dev-token',
          makeProvider: () => ({
            receipts: async () => [],
            findBatch: async (queries: string[]) => queries.map((q) => ({ query: q, candidates: found, product: found[0] ?? null })),
            addToCart: async (items: unknown[]) => { cartAdds.push(...items); },
          }),
        },
      },
    });
    await app.ready();
    me = await signIn(app, mailer, 'me@example.com');
  });

  it('мережа НЕ підключена: чесна репліка в Профіль, жодної картки', async () => {
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'а які ще опції в сільпо є по швепсу?' },
    });
    const body = r.json();
    expect(body.card).toBeNull();
    expect(body.reply).toMatch(/Профіл|Мереж/i);
  });

  it('підключена: реплікою перелічує реальні варіанти, нічого не додає в кошик', async () => {
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'а які ще опції в сільпо є по швепсу?' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.card).toBeNull();
    expect(body.reply).toMatch(/Indian Tonic/);
    expect(body.reply).toMatch(/Pink Tonic/);
    // Алкоголь відсіяний тим самим гібридним фільтром, що й альтернативи кошика.
    expect(body.reply).not.toMatch(/Шенін Блан/);
    expect(cartAdds).toHaveLength(0);

    // Нічого не потрапило ні в кошик мережі, ні в список покупок дому.
    expect(await repo.listShoppingItems(me.household_id)).toHaveLength(0);
  });

  it('нічого не знайдено — чесно каже, не мовчить і не вигадує', async () => {
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    app = buildApp(repo, new InMemoryStore(), mailer, {
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
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'а які ще опції в сільпо є по швепсу?' },
    });
    const body = r.json();
    expect(body.card).toBeNull();
    expect(body.reply).toMatch(/не знайшов|нічого/i);
  });
});
