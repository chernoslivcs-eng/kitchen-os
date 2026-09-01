// 01.09 живий репро: пошук «Original Bitter Lemon» (безалкогольний тонік)
// у Сільпо повернув алкогольний бітер і косметику як «схожі» товари —
// наївний повнотекстовий пошук мережі не бачить категорій. Гібридний
// фільтр: каталог (packages/catalog) відсіює безкоштовно те, що впізнав;
// ЛЛМ (стаб у тестах) — тільки те, чого каталог не впізнав узагалі.

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

describe('retail: гібридний фільтр альтернатив (каталог + ЛЛМ-стаб на невідоме)', () => {
  it('каталог відсіює алкоголь без ЛЛМ — «Вино Шенін Блан» серед альтернатив «швепс» не показується', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    // «Швепс» — реальна позиція каталогу (тонік/напої/рослинне), «Вино
    // Шенін Блан» — реальна позиція каталогу (алкоголь). Обидва впізнаються
    // каталогом напряму, тому рішення без жодного звернення до ЛЛМ.
    const found = [
      product('id-schweppes', 'Швепс Індіан Тонік', 33),
      product('id-wine', 'Вино Шенін Блан', 249),
      product('id-schweppes-pink', 'Швепс Пінк Тонік', 34),
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
    expect(row.product).toMatchObject({ name: 'Швепс Індіан Тонік' });
    const names = row.alternatives.map((a: { name: string }) => a.name);
    expect(names).toContain('Швепс Пінк Тонік');
    expect(names).not.toContain('Вино Шенін Блан');
  });

  it('невідоме каталогу — падає на ЛЛМ-стаб (детермінований у тестах)', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    // Вигадані назви, яких у каталозі напевно нема — резолвер поверне null,
    // рішення приймає altFilterStub (ключові слова «бітер»/«крем» тощо).
    const found = [
      product('id-x', 'Ксілоплюм Оригінал 500мл', 33),
      product('id-bad', 'Ксілоплюм Бітер преміум', 899),
      product('id-good', 'Ксілоплюм Смак Літа', 40),
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
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie }, payload: { label: 'ксілоплюм оригінал' },
    });

    const r = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/build-cart', headers: { cookie: me.cookie },
    });
    const row = r.json().card.rows[0];
    const names = row.alternatives.map((a: { name: string }) => a.name);
    expect(names).toContain('Ксілоплюм Смак Літа');
    expect(names).not.toContain('Ксілоплюм Бітер преміум');
  });
});
