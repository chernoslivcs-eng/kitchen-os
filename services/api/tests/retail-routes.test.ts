// M13, зріз 1: підключення Сільпо + «чеки → комора».
// OAuth-обмін і живий MCP підмінені інʼєкціями (той самий прийом, що
// GoogleAuthOpts.exchange) — криптографія PKCE і шифрування токенів справжні.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';
import type { RetailReceipt } from '../src/retail/silpo-provider.js';
import { RetailAuthError } from '../src/retail/silpo-provider.js';
import { localDay } from '../src/local-day.js';

const RECEIPT: RetailReceipt = {
  shop: 'вул. Київська, буд. 10', city: 'Стоянка', at: '2026-08-23T10:54:48', total: 2644,
  lines: [
    { name: 'Філе куряче охолоджене', quantity: 0.64, unit: 'кг', price: 200, image: null },
    { name: 'Папір туалетний Zewa 8 рулонів', quantity: 8, unit: 'шт', price: 189, image: null },
    { name: "Дрова Pen'ok Початок вогню №2", quantity: 1, unit: 'шт', price: 259, image: null },
  ],
};

describe('retail routes · silpo', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let me: Signed;
  let providerTokens: string[];
  // Розширюваний фейк: тести кошика докидають findBatch/addToCart.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let providerImpl: (token: string) => any;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    providerTokens = [];
    providerImpl = () => ({ receipts: async () => [RECEIPT] });
    app = buildApp(repo, new InMemoryStore(), mailer, {
      retail: {
        silpo: {
          clientId: 'test-client',
          tokenSecret: 'test-secret',
          exchange: async (code) => {
            if (code !== 'good-code') throw new Error('bad code');
            return { access_token: 'live-token', refresh_token: 'live-refresh', expires_in: 2592000 };
          },
          makeProvider: (token) => {
            providerTokens.push(token);
            return providerImpl(token);
          },
        },
      },
    });
    await app.ready();
    me = await signIn(app, mailer, 'me@example.com');
  });

  async function connect(): Promise<void> {
    const start = await app.inject({
      method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie },
    });
    expect(start.statusCode).toBe(302);
    const loc = new URL(start.headers.location as string);
    expect(loc.origin + loc.pathname).toBe('https://mcp.silpo.ua/authorize');
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
    const state = loc.searchParams.get('state')!;
    const oauthCookies = ([] as string[]).concat(start.headers['set-cookie'] as string[])
      .map((c) => c.split(';')[0]).join('; ');
    const cb = await app.inject({
      method: 'GET',
      url: `/v1/retail/silpo/callback?code=good-code&state=${state}`,
      headers: { cookie: `${me.cookie}; ${oauthCookies}` },
    });
    expect(cb.statusCode).toBe(302);
  }

  it('dev-токен: connect підключає без OAuth (тільки поза production)', async () => {
    const devApp = buildApp(repo, new InMemoryStore(), mailer, {
      retail: { silpo: { clientId: 'c', tokenSecret: 's', devAccessToken: 'dev-token-123' } },
    });
    await devApp.ready();
    const who = await signIn(devApp, mailer, 'dev@example.com');
    const r = await devApp.inject({
      method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: who.cookie },
    });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/profile?retail=connected');
    const conn = await repo.getRetailConnection(who.user_id, 'silpo');
    expect(conn?.status).toBe('active');
    expect(conn?.access_token_enc).not.toContain('dev-token-123');
  });

  it('connect(?next=/list) переживає весь OAuth-круг і повертає туди, звідки прийшли', async () => {
    const start = await app.inject({
      method: 'GET', url: '/v1/retail/silpo/connect?next=%2Flist', headers: { cookie: me.cookie },
    });
    const loc = new URL(start.headers.location as string);
    const state = loc.searchParams.get('state')!;
    const oauthCookies = ([] as string[]).concat(start.headers['set-cookie'] as string[])
      .map((c) => c.split(';')[0]).join('; ');
    const cb = await app.inject({
      method: 'GET',
      url: `/v1/retail/silpo/callback?code=good-code&state=${state}`,
      headers: { cookie: `${me.cookie}; ${oauthCookies}` },
    });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe('/list?retail=connected');
  });

  it('next, що не починається з "/" (open redirect), ігнорується — фолбек на профіль', async () => {
    const start = await app.inject({
      method: 'GET', url: '/v1/retail/silpo/connect?next=' + encodeURIComponent('//evil.example.com'),
      headers: { cookie: me.cookie },
    });
    const loc = new URL(start.headers.location as string);
    const state = loc.searchParams.get('state')!;
    const oauthCookies = ([] as string[]).concat(start.headers['set-cookie'] as string[])
      .map((c) => c.split(';')[0]).join('; ');
    const cb = await app.inject({
      method: 'GET',
      url: `/v1/retail/silpo/callback?code=good-code&state=${state}`,
      headers: { cookie: `${me.cookie}; ${oauthCookies}` },
    });
    expect(cb.headers.location).toBe('/profile?retail=connected');
  });

  it('dev-connect теж поважає ?next= (синхронний шлях, без круга)', async () => {
    const devApp = buildApp(repo, new InMemoryStore(), mailer, {
      retail: { silpo: { clientId: 'c', tokenSecret: 's', devAccessToken: 'dev-token-123' } },
    });
    await devApp.ready();
    const who = await signIn(devApp, mailer, 'dev3@example.com');
    const r = await devApp.inject({
      method: 'GET', url: '/v1/retail/silpo/connect?next=%2Flist', headers: { cookie: who.cookie },
    });
    expect(r.headers.location).toBe('/list?retail=connected');
  });

  it('без підключення статус none; connect+callback → active, токен у БД шифрований', async () => {
    const before = await app.inject({ method: 'GET', url: '/v1/retail', headers: { cookie: me.cookie } });
    expect(before.json()).toMatchObject({ silpo: { status: 'none' } });

    await connect();

    const row = await repo.getRetailConnection(me.user_id, 'silpo');
    expect(row?.status).toBe('active');
    expect(row?.access_token_enc).not.toContain('live-token');

    const after = await app.inject({ method: 'GET', url: '/v1/retail', headers: { cookie: me.cookie } });
    expect(after.json().silpo.status).toBe('active');
  });

  it('callback із чужим state — відмова, підключення не створюється', async () => {
    const start = await app.inject({
      method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie },
    });
    const oauthCookies = ([] as string[]).concat(start.headers['set-cookie'] as string[])
      .map((c) => c.split(';')[0]).join('; ');
    const cb = await app.inject({
      method: 'GET',
      url: '/v1/retail/silpo/callback?code=good-code&state=forged',
      headers: { cookie: `${me.cookie}; ${oauthCookies}` },
    });
    expect(cb.statusCode).toBe(403);
    expect(await repo.getRetailConnection(me.user_id, 'silpo')).toBeNull();
  });

  it('sync-receipts: чек → картка на підтвердження (НЕ auto-apply), метадані чека живуть у картці', async () => {
    await connect();
    const r = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/sync-receipts', headers: { cookie: me.cookie },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();

    // Провайдер отримав РОЗШИФРОВАНИЙ токен — крипта наскрізь працює.
    expect(providerTokens).toEqual(['live-token']);

    expect(body.up_to_date).toBe(false);
    expect(body.cards).toHaveLength(1);
    const c = body.cards[0];
    // 01.09: чек — не intake з чату (людина ще нічого не сказала), а дані
    // мережі. Auto-apply тут ховає від людини, ЩО саме поїхало в комору —
    // тому чек лишається на явне підтвердження, зі стрикаутом позицій.
    expect(c.auto_applied).toBe(false);
    expect(c.undo_token).toBeFalsy();
    expect(c.card.type).toBe('intake_diff');
    expect(c.text).toBe('Чек Сільпо · вул. Київська, буд. 10. Додати до комори ці покупки?');
    // Метадані джерела — В КАРТЦІ (не тільки у відповіді): стрічка рендерить
    // шапку «Чек Сільпо · …», сірі рядки і «не для комори» після перезавантаження.
    expect(c.card.source).toMatchObject({
      kind: 'retail_receipt', provider: 'silpo',
      shop: 'вул. Київська, буд. 10', total: 2644,
    });
    expect(c.card.source.nonfood.map((l: { name: string }) => l.name))
      .toEqual(['Папір туалетний Zewa 8 рулонів']);
    expect(c.card.source.unmatched.map((l: { name: string }) => l.name))
      .toEqual(["Дрова Pen'ok Початок вогню №2"]);

    // Нічого не застосовано, поки людина не тисне «Застосувати».
    expect(await repo.listBatches(me.household_id)).toHaveLength(0);

    // Збережене повідомлення несе ту саму картку з source — стрічці є що малювати.
    const messages = await repo.listMessages(
      (await repo.getOrCreateSessionForDay(me.user_id, localDay())).id,
    );
    const msg = messages.find((m) => m.id === c.card_id);
    expect((msg?.card as { source?: { kind?: string } })?.source?.kind).toBe('retail_receipt');
    expect(msg?.text).toBe('Чек Сільпо · вул. Київська, буд. 10. Додати до комори ці покупки?');

    // Явне підтвердження — тим самим шляхом, що будь-яка intake_diff-картка.
    const applyRes = await app.inject({
      method: 'POST', url: `/v1/cards/${c.card_id}/apply`, headers: { cookie: me.cookie }, payload: {},
    });
    expect(applyRes.statusCode).toBe(200);
    const batches = await repo.listBatches(me.household_id);
    const chicken = batches.find((b) => b.label === 'Філе куряче охолоджене');
    expect(chicken).toMatchObject({ value: 640, unit: 'g', provenance: 'receipt_line' });
  });

  it('повторний sync не дублює: водяний знак last_receipt_at', async () => {
    await connect();
    const first = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/sync-receipts', headers: { cookie: me.cookie },
    });
    expect(first.json().cards).toHaveLength(1);

    const again = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/sync-receipts', headers: { cookie: me.cookie },
    });
    expect(again.json()).toMatchObject({ up_to_date: true, cards: [] });

    // Чек не auto-apply — водяний знак рахується від чеків, які СИНКНУЛИСЬ,
    // не від тих, що людина підтвердила. Перевіряємо саме дедуп синку.
    expect(first.json().cards[0].card.ops.some((o: { label: string }) => o.label === 'Філе куряче охолоджене'))
      .toBe(true);

    // Зʼявився новіший чек — імпортується ТІЛЬКИ він.
    const fresh = { ...RECEIPT, at: '2026-08-30T09:00:00', shop: 'Нова філія', lines: [RECEIPT.lines[0]!] };
    providerImpl = () => ({ receipts: async () => [fresh, RECEIPT] });
    const third = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/sync-receipts', headers: { cookie: me.cookie },
    });
    const body3 = third.json();
    expect(body3.cards).toHaveLength(1);
    expect(body3.cards[0].card.source.shop).toBe('Нова філія');
  });

  it('disconnect мʼякий: sync блокується 409, reconnect повертає без нового OAuth', async () => {
    await connect();
    const off = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/disconnect', headers: { cookie: me.cookie },
    });
    expect(off.statusCode).toBe(200);
    expect((await repo.getRetailConnection(me.user_id, 'silpo'))?.status).toBe('disconnected');

    const sync = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/sync-receipts', headers: { cookie: me.cookie },
    });
    expect(sync.statusCode).toBe(409);

    const on = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/reconnect', headers: { cookie: me.cookie },
    });
    expect(on.statusCode).toBe(200);
    expect((await repo.getRetailConnection(me.user_id, 'silpo'))?.status).toBe('active');
  });

  it('build-cart: список → пошук (двофазний) → кошик мережі → картка в стрічці', async () => {
    await connect();
    // Список: лосось знайдеться другою фазою (канонічним імʼям з каталогу),
    // кунжут — чесний misс, вода — перша фаза.
    for (const [label, v, u] of [
      ['Стейк з лосося охолоджений', 300, 'g'],
      ['кунжут', null, null],
      ['вода мінеральна', null, null],
    ] as const) {
      await app.inject({
        method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie },
        payload: { label, ...(v ? { v, u } : {}) },
      });
    }

    const findCalls: string[][] = [];
    const cartAdds: Array<{ productId: string; quantity: number }> = [];
    providerImpl = () => ({
      receipts: async () => [],
      findBatch: async (queries: string[]) => {
        findCalls.push(queries);
        return queries.map((q) => ({
          query: q,
          candidates: [],
          product: (q === 'вода мінеральна' || q === 'Лосось охолоджений')
            ? {
                id: `id-${q}`, name: `Сільпо: ${q}`, slug: q, price: 200, oldPrice: null,
                stock: true, available: true, weighted: q === 'Лосось охолоджений', step: 1,
                companyId: 'c1', branchId: 'b1',
              }
            : null,
        }));
      },
      addToCart: async (items: Array<{ productId: string; quantity: number; companyId: string; branchId: string }>) => {
        cartAdds.push(...items);
      },
    });

    const r = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/build-cart', headers: { cookie: me.cookie },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();

    // Друга фаза пішла канонічним іменем каталогу тільки для промахів.
    expect(findCalls[0]).toEqual(['Стейк з лосося охолоджений', 'кунжут', 'вода мінеральна']);
    expect(findCalls[1]).toEqual(['Лосось охолоджений', 'Кунжут білий']);
    expect(findCalls[1]).not.toContain('вода мінеральна');

    expect(body.card.type).toBe('cart');
    expect(body.card.found).toBe(2);
    expect(body.card.of).toBe(3);
    expect(body.card.total).toBe(260); // вода 200 + лосось 200грн/кг × 0.3кг
    const rows = body.card.rows as Array<{ label: string; product: { name: string; quantity: number } | null }>;
    expect(rows.find((x) => x.label === 'кунжут')?.product).toBeNull();
    // Ваговий лосось: 300 г → 0.3 кг у кошику мережі.
    expect(cartAdds.find((a) => a.productId === 'id-Лосось охолоджений')?.quantity).toBeCloseTo(0.3);
    expect(cartAdds).toHaveLength(2);

    // Картка лягла в сесію дня — стрічка її покаже.
    const { id } = await repo.getOrCreateSessionForDay(me.user_id, localDay());
    const msg = (await repo.listMessages(id)).find((m) => m.id === body.card_id);
    expect((msg?.card as { type?: string })?.type).toBe('cart');
  });

  it('build-cart: промах отримує заміну третьою фазою (головне слово каталогу)', async () => {
    await connect();
    await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie },
      payload: { label: 'рис арборіо' },
    });
    const findCalls: string[][] = [];
    const cartAdds: Array<{ productId: string }> = [];
    providerImpl = () => ({
      receipts: async () => [],
      findBatch: async (queries: string[]) => {
        findCalls.push(queries);
        return queries.map((q) => {
          // Точного арборіо немає ніде; на «рис» (голова) — є два варіанти.
          // Живий провайдер бере product = candidates[0] — стаб дзеркалить це.
          const products = q === 'рис' ? [
            { id: 'id-rice', name: 'Рис круглозернистий «Хуторок»', slug: 'rice', price: 89, oldPrice: null,
              stock: true, available: true, weighted: false, step: 1, companyId: 'c1', branchId: 'b1' },
            { id: 'id-rice-basmati', name: 'Рис басматі', slug: 'rice-basmati', price: 145, oldPrice: null,
              stock: true, available: true, weighted: false, step: 1, companyId: 'c1', branchId: 'b1' },
          ] : [];
          return { query: q, candidates: products, product: products[0] ?? null };
        });
      },
      addToCart: async (items: Array<{ productId: string }>) => { cartAdds.push(...items); },
    });

    const r = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/build-cart', headers: { cookie: me.cookie },
    });
    const body = r.json();
    // Лінк «Оформити» — на головну: silpo.ua/cart мережа прибрала (404),
    // кошик у них живе попапом на будь-якій сторінці.
    expect(body.card.cart_url).toBe('https://silpo.ua');
    const row = body.card.rows[0];
    // Заміну НЕ кладемо в кошик самі — «не вгадувати»: пропозиція під тапом.
    // Проміс лишає ВСІ кандидати того самого пошуку як кнопки заміни.
    expect(row.product).toBeNull();
    expect(row.alternatives).toMatchObject([
      { name: 'Рис круглозернистий «Хуторок»', price: 89 },
      { name: 'Рис басматі', price: 145 },
    ]);
    expect(cartAdds).toHaveLength(0);

    // Тап «замінити» на першому варіанті: він їде в кошик мережі, картка
    // правиться в БД, другий кандидат лишається — тепер інформаційно.
    const swap = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/cart-swap', headers: { cookie: me.cookie },
      payload: { card_id: body.card_id, row_index: 0, alt_index: 0 },
    });
    expect(swap.statusCode).toBe(200);
    expect(cartAdds.map((a) => a.productId)).toEqual(['id-rice']);
    const patched = swap.json().card;
    expect(patched.rows[0].product).toMatchObject({ name: 'Рис круглозернистий «Хуторок»' });
    expect(patched.rows[0].alternatives).toMatchObject([{ name: 'Рис басматі', price: 145 }]);
    expect(patched.found).toBe(1);
    expect(patched.total).toBe(89);

    const { id } = await repo.getOrCreateSessionForDay(me.user_id, localDay());
    const msg = (await repo.listMessages(id)).find((m) => m.id === body.card_id);
    expect((msg?.card as { found?: number })?.found).toBe(1);
  });

  it('мутуючі retail-роути мають ліміт: 429 після вичерпання, ключ — user_id', async () => {
    const limitedApp = buildApp(repo, new InMemoryStore(), mailer, {
      retail: {
        silpo: {
          clientId: 'test-client', tokenSecret: 'test-secret',
          rateLimit: { max: 2, windowMs: 60_000 },
          exchange: async () => ({ access_token: 'live-token', refresh_token: 'live-refresh', expires_in: 2592000 }),
          makeProvider: () => ({
            receipts: async () => [],
            findBatch: async () => [],
            addToCart: async () => {},
          }),
        },
      },
    });
    await limitedApp.ready();
    const who = await signIn(limitedApp, mailer, 'ratelimited@example.com');
    // connect/callback НЕ лімітовані (браузерна навігація, не JSON-мутація);
    // лічильник має рахувати саме sync-receipts.
    const start = await limitedApp.inject({
      method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: who.cookie },
    });
    const loc = new URL(start.headers.location as string);
    const state = loc.searchParams.get('state')!;
    const oauthCookies = ([] as string[]).concat(start.headers['set-cookie'] as string[])
      .map((c) => c.split(';')[0]).join('; ');
    await limitedApp.inject({
      method: 'GET', url: `/v1/retail/silpo/callback?code=x&state=${state}`,
      headers: { cookie: `${who.cookie}; ${oauthCookies}` },
    });

    const r1 = await limitedApp.inject({ method: 'POST', url: '/v1/retail/silpo/sync-receipts', headers: { cookie: who.cookie } });
    const r2 = await limitedApp.inject({ method: 'POST', url: '/v1/retail/silpo/sync-receipts', headers: { cookie: who.cookie } });
    const r3 = await limitedApp.inject({ method: 'POST', url: '/v1/retail/silpo/sync-receipts', headers: { cookie: who.cookie } });
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
    expect(r3.statusCode).toBe(429);
  });

  it('build-cart без жодної позиції — 409 empty_list, нічого не створюється', async () => {
    await connect();
    const r = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/build-cart', headers: { cookie: me.cookie },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('empty_list');
  });

  it('протухлий access-токен автоматично оновлюється через refresh_token — людина нічого не бачить', async () => {
    await connect();
    let refreshCalls = 0;
    const refreshApp = buildApp(repo, new InMemoryStore(), mailer, {
      retail: {
        silpo: {
          clientId: 'test-client',
          tokenSecret: 'test-secret',
          refresh: async (refreshToken) => {
            refreshCalls++;
            expect(refreshToken).toBe('live-refresh'); // саме той, що зберігся при connect()
            return { access_token: 'refreshed-token', refresh_token: 'refreshed-refresh', expires_in: 2592000 };
          },
          makeProvider: (token) => {
            providerTokens.push(token);
            // Старий токен ще «в мережі» вважається протухлим — RetailAuthError;
            // новий, отриманий через refresh, працює одразу.
            if (token === 'refreshed-token') return providerImpl(token);
            return { receipts: async () => { throw new RetailAuthError(); } };
          },
        },
      },
    });
    await refreshApp.ready();

    const r = await refreshApp.inject({
      method: 'POST', url: '/v1/retail/silpo/sync-receipts', headers: { cookie: me.cookie },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().cards).toHaveLength(1);
    expect(refreshCalls).toBe(1);
    expect(providerTokens).toEqual(['live-token', 'refreshed-token']);

    // Нові токени лягли в БД шифровано, старий refresh_token замінений.
    const conn = await repo.getRetailConnection(me.user_id, 'silpo');
    expect(conn?.access_token_enc).not.toContain('refreshed-token');
    expect(conn?.refresh_token_enc).not.toContain('refreshed-refresh');
  });

  it('refresh не рятує (токен відкликаний мережею) → 401 retail_auth, не 500, і без нескінченного циклу', async () => {
    await connect();
    let refreshCalls = 0;
    const refreshApp = buildApp(repo, new InMemoryStore(), mailer, {
      retail: {
        silpo: {
          clientId: 'test-client',
          tokenSecret: 'test-secret',
          refresh: async () => { refreshCalls++; throw new Error('invalid_grant'); },
          makeProvider: () => ({
            receipts: async () => { throw new RetailAuthError(); },
            findBatch: async () => { throw new RetailAuthError(); },
            addToCart: async () => { throw new RetailAuthError(); },
          }),
        },
      },
    });
    await refreshApp.ready();

    const r = await refreshApp.inject({
      method: 'POST', url: '/v1/retail/silpo/sync-receipts', headers: { cookie: me.cookie },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe('retail_auth');
    expect(refreshCalls).toBe(1); // рівно раз — без ретраю в петлі
  });

  it('немає refresh_token (dev-конект) — 401 без спроби рефрешу', async () => {
    let refreshCalls = 0;
    const devApp = buildApp(repo, new InMemoryStore(), mailer, {
      retail: {
        silpo: {
          clientId: 'c', tokenSecret: 's', devAccessToken: 'dev-token-xyz',
          refresh: async () => { refreshCalls++; throw new Error('should not be called'); },
          makeProvider: () => ({
            receipts: async () => { throw new RetailAuthError(); },
            findBatch: async () => { throw new RetailAuthError(); },
            addToCart: async () => { throw new RetailAuthError(); },
          }),
        },
      },
    });
    await devApp.ready();
    const who = await signIn(devApp, mailer, 'dev2@example.com');
    await devApp.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: who.cookie } });

    const r = await devApp.inject({
      method: 'POST', url: '/v1/retail/silpo/sync-receipts', headers: { cookie: who.cookie },
    });
    expect(r.statusCode).toBe(401);
    expect(refreshCalls).toBe(0);
  });

  it('протухлий токен у мережі → 401 retail_auth (сигнал «Увійти знову», не 500)', async () => {
    await connect();
    providerImpl = () => ({ receipts: async () => { throw new RetailAuthError(); } });
    const r = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/sync-receipts', headers: { cookie: me.cookie },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe('retail_auth');
  });
});
