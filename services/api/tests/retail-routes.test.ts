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
  let providerImpl: (token: string) => { receipts(): Promise<RetailReceipt[]> };

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

  it('sync-receipts: чек → auto-apply в комору, метадані чека живуть у картці', async () => {
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
    expect(c.auto_applied).toBe(true);
    expect(c.undo_token).toBeTruthy();
    expect(c.card.type).toBe('intake_diff');
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

    const batches = await repo.listBatches(me.household_id);
    const chicken = batches.find((b) => b.label === 'Філе куряче охолоджене');
    expect(chicken).toMatchObject({ value: 640, unit: 'g', provenance: 'receipt_line' });

    // Збережене повідомлення несе ту саму картку з source — стрічці є що малювати.
    const messages = await repo.listMessages(
      (await repo.getOrCreateSessionForDay(me.user_id, new Date().toISOString().slice(0, 10))).id,
    );
    const msg = messages.find((m) => m.id === c.card_id);
    expect((msg?.card as { source?: { kind?: string } })?.source?.kind).toBe('retail_receipt');
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

    const batches = await repo.listBatches(me.household_id);
    expect(batches.filter((b) => b.label === 'Філе куряче охолоджене')).toHaveLength(1);

    // Зʼявився новіший чек — імпортується ТІЛЬКИ він.
    const fresh = { ...RECEIPT, at: '2026-08-30T09:00:00', shop: 'Нова філія', lines: [RECEIPT.lines[0]!] };
    providerImpl = () => ({ receipts: async () => [fresh, RECEIPT] });
    const third = await app.inject({
      method: 'POST', url: '/v1/retail/silpo/sync-receipts', headers: { cookie: me.cookie },
    });
    const body3 = third.json();
    expect(body3.cards).toHaveLength(1);
    expect(body3.cards[0].card.source.shop).toBe('Нова філія');
    expect((await repo.listBatches(me.household_id)).filter((b) => b.label === 'Філе куряче охолоджене'))
      .toHaveLength(2);
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
