// Пошук «що є / почім» по кількох джерелах: Сільпо (лише підключене) і
// Стейки Карпат (відкритий каталог). Найдорожчий баг — мовчання: людина без
// Сільпо мусить усе одно побачити, що мʼясо є в Карпатах, а людина з Сільпо —
// обидва джерела, кожне своїм абзацом.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, buildKitchenContext } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';

const silpoFound = [
  { id: 's1', name: 'Стейк Рібай Сільпо 300 г', slug: 'x', price: 420, oldPrice: null, stock: true, available: true, weighted: false, step: 1, companyId: 'c', branchId: 'b' },
];
const karpatyFound = [
  { name: 'Рібай Прайм King', article: '007252', price: 794, url: 'https://karpatysteaks.com/ribeye', inStock: true },
  { name: 'Рібай Dry-Aged', article: '007628', price: 1095, url: 'https://karpatysteaks.com/dry', inStock: true },
  { name: 'Рібай, якого нема', article: '0', price: 1, url: '', inStock: false },
];

function makeApp(repo: InMemoryRepo, mailer: ConsoleMailer, karpatyFails = false) {
  return buildApp(repo, new InMemoryStore(), mailer, {
    retail: {
      silpo: {
        clientId: 'c', tokenSecret: 's', devAccessToken: 'dev-token',
        makeProvider: () => ({
          receipts: async () => [],
          findBatch: async (queries: string[]) => queries.map((q) => ({ query: q, candidates: silpoFound, product: silpoFound[0] ?? null })),
          addToCart: async () => {},
        }),
      },
      karpaty: {
        makeProvider: () => ({
          search: async () => { if (karpatyFails) throw new Error('HTTP 503'); return karpatyFound; },
        }),
      },
    },
  });
}

describe('retail_search_go по кількох джерелах', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let me: Signed;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = makeApp(repo, mailer);
    await app.ready();
    me = await signIn(app, mailer, 'meat@example.com');
  });

  it('Сільпо не підключено — Стейки Карпат усе одно відповідають, без товарів «нема в наявності»', async () => {
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'які ще варіанти в мережі по рібаю?' },
    });
    const body = r.json() as { reply: string; card: unknown };
    expect(body.card).toBeNull();
    expect(body.reply).toContain('Сільпо не підключено');
    expect(body.reply).toContain('У Стейках Карпат є');
    expect(body.reply).toContain('Рібай Прайм King · 794₴');
    expect(body.reply).not.toContain('якого нема');
    expect(body.reply).toContain('karpatysteaks.com');
  });

  it('Сільпо підключено — два абзаци, кожне джерело своїм', async () => {
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'які ще варіанти в мережі по рібаю?' },
    });
    const reply = (r.json() as { reply: string }).reply;
    expect(reply).toContain('У Сільпо є');
    expect(reply).toContain('Стейк Рібай Сільпо 300 г · 420₴');
    expect(reply).toContain('У Стейках Карпат є');
  });

  it('Карпати не відповідають — один чесний рядок, решта репліки жива', async () => {
    const failing = makeApp(repo, mailer, true);
    await failing.ready();
    const who = await signIn(failing, mailer, 'meat2@example.com');
    await failing.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: who.cookie } });
    const r = await failing.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: who.cookie },
      payload: { text: 'які ще варіанти в мережі по рібаю?' },
    });
    const reply = (r.json() as { reply: string }).reply;
    expect(reply).toContain('У Сільпо є');
    expect(reply).toContain('Стейки Карпат зараз не відповідає');
  });

  it('GET /v1/retail знає про відкрите джерело', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/retail', headers: { cookie: me.cookie } });
    expect((r.json() as { karpaty: { status: string } }).karpaty.status).toBe('available');
  });

  it('[МЕРЕЖІ] у контексті називає Стейки Карпат навіть без Сільпо', () => {
    const ctx = buildKitchenContext({ profile: null, pantry: [], retailConnected: false, retailKarpaty: true } as Parameters<typeof buildKitchenContext>[0]);
    expect(ctx).toContain('[МЕРЕЖІ]');
    expect(ctx).toContain('Сільпо: не підключено');
    expect(ctx).toContain('Стейки Карпат: доступно без підключення');
  });
});
