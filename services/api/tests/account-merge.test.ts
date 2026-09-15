// Злиття акаунтів (власник 15.09): Google-акаунт + Telegram-акаунт-дубль.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, signInWithTelegram } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { handleTelegramText, createTelegramLinkToken, resetSeenUpdates, resetBotUsernameCache, COPY } from '../src/telegram.js';

const BOT = 'KitchenOSAppBot';
const APP = 'https://app.test';

describe('злиття акаунтів', () => {
  let repo: InMemoryRepo; let mailer: ConsoleMailer; let store: InMemoryStore; let app: ReturnType<typeof buildApp>;
  let seq = 0;
  const upd = (telegram_user_id: number, text: string) => ({ update_id: ++seq, telegram_user_id, chat_id: telegram_user_id, text });
  const deps = () => ({ repo, store, appUrl: APP });
  beforeEach(async () => {
    repo = new InMemoryRepo(); mailer = new ConsoleMailer(); store = new InMemoryStore(); resetSeenUpdates(); resetBotUsernameCache();
    process.env.TELEGRAM_BOT_USERNAME = BOT;
    app = buildApp(repo, store, mailer, { telegramAuth: { botToken: '123456789:test-bot-token-not-real', botId: '123456789', botUsername: BOT } });
    await app.ready();
  });
  const post = (url: string, cookie: string, payload: Record<string, unknown> = {}) => app.inject({ method: 'POST', url, headers: { cookie }, payload });
  const conflict = (cookie: string) => app.inject({ method: 'GET', url: '/v1/account/conflict', headers: { cookie } });

  /** Яна: web-акаунт + окремий Telegram-акаунт (777) із власним домом; потім «Підключити Telegram» у профілі. */
  async function yana() {
    const web = await signIn(app, mailer, 'yana@example.com');
    const tg = await signInWithTelegram(repo, { telegram_user_id: 777, chat_id: 777, first_name: 'Яна' });
    const { token } = await createTelegramLinkToken(repo, web.user_id, BOT);
    const reply = await handleTelegramText(deps(), upd(777, `/start ${token}`));
    return { web, tg, reply };
  }

  it('бот: /start без лінка — другим абзацом «уже є акаунт на сайті?»', async () => {
    const r = await handleTelegramText(deps(), upd(1, '/start'));
    expect(r?.messages).toHaveLength(2);
    expect(r?.messages[1]).toBe(COPY.helloHasAccount);
  });

  it('бот: «Підключити» з профілю, а Telegram уже чужий — не перепривʼязує, пише конфлікт; профіль бачить дубль', async () => {
    const { web, tg, reply } = await yana();
    expect(reply).toEqual({ messages: [COPY.linkConflict], html: false });
    expect((await repo.getUserByTelegramId(777))!.id).toBe(tg.user_id);
    const c = conflict(web.cookie);
    expect((await c).json()).toMatchObject({ kind: 'telegram', from_user_id: tg.user_id, sole_member: true, pantry_count: 0 });
  });

  it('merge без доведення — 403; чужий from_user_id — 403', async () => {
    const web = await signIn(app, mailer, 'a@example.com');
    const other = await signIn(app, mailer, 'b@example.com');
    expect((await post('/v1/account/merge', web.cookie, { from_user_id: other.user_id })).statusCode).toBe(403);
    expect((await post('/v1/account/merge', web.cookie, {})).statusCode).toBe(400);
  });

  it('merge: дубль не один у домі — 409 «Спершу вийди з дому»', async () => {
    const { web, tg } = await yana();
    const mate = await signIn(app, mailer, 'mate@example.com');
    await repo.addMember(tg.household_id, mate.user_id, 'member');
    const r = await post('/v1/account/merge', web.cookie, { from_user_id: tg.user_id });
    expect(r.statusCode).toBe(409);
    expect(r.json().message).toMatch(/^Спершу вийди з дому «.+» — тоді обʼєднаємо$/);
    expect((await conflict(web.cookie)).json()).toMatchObject({ sole_member: false });
  });

  it('merge: успіх — Telegram на web-акаунті, дубль зник, конфлікт знято, GET /v1/telegram linked', async () => {
    const { web, tg } = await yana();
    const r = await post('/v1/account/merge', web.cookie, { from_user_id: tg.user_id });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, kind: 'telegram' });
    expect((await repo.getUserByTelegramId(777))!.id).toBe(web.user_id);
    expect(await repo.getUser(tg.user_id)).toBeNull();
    expect((await conflict(web.cookie)).json()).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/v1/telegram', headers: { cookie: web.cookie } })).json()).toMatchObject({ linked: true });
    // Повторно — 403: доведення спожите разом зі злиттям.
    expect((await post('/v1/account/merge', web.cookie, { from_user_id: tg.user_id })).statusCode).toBe(403);
  });

  it('«Ні, лишити окремо» — конфлікт знято, merge більше не дозволений', async () => {
    const { web, tg } = await yana();
    expect((await post('/v1/account/conflict/dismiss', web.cookie)).json()).toEqual({ ok: true });
    expect((await conflict(web.cookie)).json()).toBeNull();
    expect((await post('/v1/account/merge', web.cookie, { from_user_id: tg.user_id })).statusCode).toBe(403);
    expect((await repo.getUserByTelegramId(777))!.id).toBe(tg.user_id);
  });

  it('лендинг «Увійти» (mode login): /start login_ без акаунта — не створює, poll → no_account', async () => {
    const begin = await app.inject({ method: 'POST', url: '/v1/auth/telegram/begin', payload: { mode: 'login' } });
    const { token } = begin.json() as { token: string };
    const r = await handleTelegramText(deps(), upd(4242, `/start login_${token}`));
    expect(r).toEqual({ messages: [COPY.loginNoAccount], html: false });
    expect(await repo.getUserByTelegramId(4242)).toBeNull();
    const poll = await app.inject({ method: 'GET', url: `/v1/auth/telegram/poll?token=${encodeURIComponent(token)}` });
    expect(poll.json()).toEqual({ status: 'no_account' });
  });

  it('лендинг «Почати» (mode start, дефолт): /start login_ створює акаунт, як досі', async () => {
    const begin = await app.inject({ method: 'POST', url: '/v1/auth/telegram/begin', payload: {} });
    const { token } = begin.json() as { token: string };
    await handleTelegramText(deps(), upd(4343, `/start login_${token}`));
    expect(await repo.getUserByTelegramId(4343)).not.toBeNull();
  });
});
