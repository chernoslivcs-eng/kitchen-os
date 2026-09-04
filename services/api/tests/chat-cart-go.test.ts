// M13: «асистент повинен мати руки» — живий кейс. Юзер написав «замовим це
// в сільпо» і отримав категоричну відмову моделі, хоча build-cart уже давно
// вміє це зробити. Модель маркує намір карткою cart_go (той самий принцип,
// що cook_go для «давай готуємо»), сервер сам виконує attemptBuildCart і
// підміняє картку на справжній cart — ОДНИМ ходом, без другого кола торгу.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';
import { localDay } from '../src/local-day.js';

describe('чат: cart_go → живий кошик одним ходом', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let me: Signed;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer, {
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
    await app.ready();
    me = await signIn(app, mailer, 'me@example.com');
  });

  it('мережа НЕ підключена: чесна репліка в Профіль, жодної картки', async () => {
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'замов це в сільпо' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.card).toBeNull();
    expect(body.reply).toMatch(/Профіл|Мереж/i);
  });

  it('підключена, список порожній: чесно каже, картки нема', async () => {
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'зберіть кошик у сільпо' },
    });
    const body = r.json();
    expect(body.card).toBeNull();
    expect(body.reply).toMatch(/порожн/i);
  });

  it('підключена, список непорожній: одним ходом — реальна картка cart, не cart_go', async () => {
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie },
      payload: { label: 'кунжут' },
    });
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'оформи замовлення в сільпо' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.card?.type).toBe('cart');
    expect(body.card?.found).toBe(1);
    expect(body.card_id).toBeTruthy();

    // Картка лягла в сесію дня — переживає F5, як і кнопка зі Списку.
    const { id } = await repo.getOrCreateSessionForDay(me.user_id, localDay());
    const msg = (await repo.listMessages(id)).find((m) => m.id === body.card_id);
    expect((msg?.card as { type?: string })?.type).toBe('cart');
  });

  // Живий репро 01.09: «замов це в сільпо» після перегляду чека — у списку
  // покупок лежав тільки кунжут, а замовити хотіли позиції з чека, яких у
  // списку ще не було. cart_go без полів бачить лише персистований список —
  // тому картка тепер може нести items: явні лейбли з розмови, і сервер шукає
  // саме їх, ігноруючи список.
  it('cart_go з явними позиціями (items) — шукає саме їх, а не персистований список', async () => {
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie },
      payload: { label: 'кунжут' },
    });
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'замов лосось і рис в сільпо' },
    });
    const body = r.json();
    expect(body.card?.type).toBe('cart');
    expect(body.card?.found).toBe(2);
    expect(body.card?.of).toBe(2);
    const labels = (body.card?.rows ?? []).map((row: { label: string }) => row.label.toLowerCase());
    expect(labels).toEqual(expect.arrayContaining(['лосось', 'рис']));
    expect(labels).not.toContain('кунжут');
  });
});
