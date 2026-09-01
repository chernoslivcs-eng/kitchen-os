// M13 01.09, коментарі #3 і #4 з живого тестування:
// - після cart_go з явними items (частина списку) — про решту списку модель
//   мовчить, хоча знає, що там ще щось є (комент #3).
// - «прибери X з замовлення» після того, як кошик уже зібрано, раніше
//   валила чат (fixed окремо); тепер, коли не валить, людина лишається без
//   шляху вперед — жодної пропозиції зібрати кошик заново (комент #4).
// Обидва нуджі — серверна, детермінована репліка, не покладаємось на те, що
// стаб/жива модель сама здогадається їх дописати.

import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

function makeApp() {
  const repo = new InMemoryRepo();
  const mailer = new ConsoleMailer();
  const app = buildApp(repo, new InMemoryStore(), mailer, {
    retail: {
      silpo: {
        clientId: 'c', tokenSecret: 's', devAccessToken: 'dev-token',
        makeProvider: () => ({
          receipts: async () => [],
          findBatch: async (queries: string[]) => queries.map((q) => ({
            query: q, candidates: [],
            product: { id: `id-${q}`, name: `Товар ${q}`, slug: q, price: 50, oldPrice: null,
              stock: true, available: true, weighted: false, step: 1, companyId: 'c1', branchId: 'b1' },
          })),
          addToCart: async () => {},
        }),
      },
    },
  });
  return { repo, mailer, app };
}

describe('чат: нуджі навколо cart_go — «є ще» і «зібрати заново»', () => {
  it('cart_go з explicit items — reply згадує решту списку поза замовленням', async () => {
    const { repo, mailer, app } = makeApp();
    await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie }, payload: { label: 'кунжут' },
    });
    await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie }, payload: { label: 'сіль' },
    });

    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'замов лосось в сільпо' },
    });
    const body = r.json();
    expect(body.card?.type).toBe('cart');
    expect(body.reply).toMatch(/кунжут/i);
    expect(body.reply).toMatch(/сіль/i);
  });

  it('«прибери X зі списку» після того, як кошик уже був зібраний — reply пропонує зібрати заново', async () => {
    const { repo, mailer, app } = makeApp();
    await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie }, payload: { label: 'швепс' },
    });
    await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'оформи замовлення в сільпо' },
    });

    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'прибери швепс зі списку' },
    });
    const body = r.json();
    expect(body.auto_applied).toBe(true);
    expect(body.reply).toMatch(/кошик/i);
    expect(body.reply).toMatch(/заново|перезбер/i);
  });

  it('«прибери X з замовлення» (не «зі списку») — теж shopping-remove, теж нудж перезібрати', async () => {
    const { repo, mailer, app } = makeApp();
    await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie }, payload: { label: 'швепс' },
    });
    await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'оформи замовлення в сільпо' },
    });

    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'тоді прибери з замовлення швепс' },
    });
    const body = r.json();
    expect(body.card?.type).toBe('shopping');
    expect(body.auto_applied).toBe(true);
    expect((await repo.listShoppingItems(me.household_id)).map((i) => i.label.toLowerCase())).not.toContain('швепс');
    expect(body.reply).toMatch(/заново|перезбер/i);
  });

  it('«прибери X зі списку» БЕЗ попереднього кошика — нуджу нема (нема що перезбирати)', async () => {
    const { repo, mailer, app } = makeApp();
    await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie }, payload: { label: 'швепс' },
    });

    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'прибери швепс зі списку' },
    });
    const body = r.json();
    expect(body.auto_applied).toBe(true);
    expect(body.reply).not.toMatch(/заново|перезбер/i);
  });
});
