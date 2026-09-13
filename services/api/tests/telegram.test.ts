// Р147 (TELEGRAM-PLAN-0913, PR 1): привʼязка (токен разовий, 15 хв), запис ходу
// в сесію дня з channel: 'telegram' без моделі, /stop, дубль update_id, профіль.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { handleTelegramText, createTelegramLinkToken, resetSeenUpdates, resetBotUsernameCache, COPY, TELEGRAM_LINK_TTL_MS } from '../src/telegram.js';
import { localDay } from '../src/local-day.js';

const APP = 'https://kos.example';
const BOT = 'KitchenOSBot';

describe('Р147 · Telegram', () => {
  let repo: InMemoryRepo; let mailer: ConsoleMailer; let app: ReturnType<typeof buildApp>;
  let seq = 0;
  const upd = (telegram_user_id: number, text: string, chat_id = telegram_user_id) => ({ update_id: ++seq, telegram_user_id, chat_id, text });
  beforeEach(async () => {
    repo = new InMemoryRepo(); mailer = new ConsoleMailer(); resetSeenUpdates(); resetBotUsernameCache();
    process.env.TELEGRAM_BOT_USERNAME = BOT;
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('без username (нема env і токена) — link-token → 503, GET username null', async () => {
    delete process.env.TELEGRAM_BOT_USERNAME; delete process.env.TELEGRAM_BOT_TOKEN;
    const me = await signIn(app, mailer, 'me@example.com');
    expect((await app.inject({ method: 'GET', url: '/v1/telegram', headers: { cookie: me.cookie } })).json()).toEqual({ linked: false, username: null, linked_at: null });
    const tok = await app.inject({ method: 'POST', url: '/v1/telegram/link-token', headers: { cookie: me.cookie, 'content-type': 'application/json' }, payload: '{}' });
    expect(tok.statusCode).toBe(503);
  });

  it('/start без токена або з чужим — «Спершу підключи…»; текст від непривʼязаного — те саме', async () => {
    expect(await handleTelegramText({ repo, appUrl: APP }, upd(100, '/start'))).toBe(COPY.linkFirst(APP));
    expect(await handleTelegramText({ repo, appUrl: APP }, upd(100, '/start nope'))).toBe(COPY.linkFirst(APP));
    expect(await handleTelegramText({ repo, appUrl: APP }, upd(100, 'привіт'))).toBe(COPY.linkFirst(APP));
  });

  it('контракт профілю: GET → { linked, username, linked_at }; POST link-token → { url, expires_at }; /start <token> → привʼязка; токен разовий', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const before = await app.inject({ method: 'GET', url: '/v1/telegram', headers: { cookie: me.cookie } });
    expect(before.json()).toEqual({ linked: false, username: BOT, linked_at: null });
    const tok = await app.inject({ method: 'POST', url: '/v1/telegram/link-token', headers: { cookie: me.cookie, 'content-type': 'application/json' }, payload: '{}' });
    expect(tok.statusCode).toBe(200);
    const body = tok.json() as { url: string; expires_at: string };
    expect(Object.keys(body).sort()).toEqual(['expires_at', 'url']);
    expect(body.url).toMatch(new RegExp(`^https://t\\.me/${BOT}\\?start=[A-Za-z0-9_-]+$`));
    expect(Date.parse(body.expires_at) - Date.now()).toBeGreaterThan(14 * 60_000);
    const token = decodeURIComponent(body.url.split('start=')[1]!);

    const reply = await handleTelegramText({ repo, appUrl: APP }, upd(500, `/start ${token}`, 777));
    expect(reply).toMatch(/^Привіт, /);
    expect(reply).toContain('Це кухня дому');
    const acc = await repo.getTelegramByTelegramUser(500);
    expect(acc).toMatchObject({ user_id: me.user_id, chat_id: 777, revoked_at: null });
    const after = await app.inject({ method: 'GET', url: '/v1/telegram', headers: { cookie: me.cookie } });
    expect(after.json()).toMatchObject({ linked: true, username: BOT });
    expect(Date.parse((after.json() as { linked_at: string }).linked_at)).toBeGreaterThan(0);

    // той самий токен удруге — не спрацьовує
    expect(await handleTelegramText({ repo, appUrl: APP }, upd(501, `/start ${token}`))).toBe(COPY.linkFirst(APP));
  });

  it('токен живе 15 хвилин', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const t0 = new Date('2026-09-13T10:00:00Z');
    const { token } = await createTelegramLinkToken(repo, me.user_id, BOT, t0);
    const late = new Date(t0.getTime() + TELEGRAM_LINK_TTL_MS + 1000);
    expect(await handleTelegramText({ repo, appUrl: APP, now: () => late }, upd(600, `/start ${token}`))).toBe(COPY.linkFirst(APP));
    const { token: t2 } = await createTelegramLinkToken(repo, me.user_id, BOT, t0);
    const inTime = new Date(t0.getTime() + TELEGRAM_LINK_TTL_MS - 1000);
    expect(await handleTelegramText({ repo, appUrl: APP, now: () => inTime }, upd(601, `/start ${t2}`))).toMatch(/^Привіт/);
  });

  it('текст привʼязаного → хід у сесію дня з channel telegram, без моделі; заголовок сесії; веб бачить channel', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const { token } = await createTelegramLinkToken(repo, me.user_id, BOT);
    await handleTelegramText({ repo, appUrl: APP }, upd(700, `/start ${token}`));
    const reply = await handleTelegramText({ repo, appUrl: APP }, upd(700, 'купив молоко і хліб'));
    expect(reply).toBe(COPY.recorded);
    const session = await repo.getOrCreateSessionForDay(me.user_id, localDay());
    const msgs = await repo.listMessages(session.id);
    const mine = msgs.filter((m) => m.role === 'user');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ text: 'купив молоко і хліб', channel: 'telegram' });
    expect(msgs.filter((m) => m.role === 'assistant' && m.text !== null && !m.card).length, 'відповіді моделі нема').toBe(0);
    expect(session.title ?? (await repo.getSession(session.id))?.title).toBeTruthy();
    const web = await app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie } });
    const shown = (web.json() as { messages: { text: string | null; channel?: string }[] }).messages.find((m) => m.text === 'купив молоко і хліб');
    expect(shown?.channel).toBe('telegram');
  });

  it('дубль update_id — ігнорується, другого ходу нема', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const { token } = await createTelegramLinkToken(repo, me.user_id, BOT);
    await handleTelegramText({ repo, appUrl: APP }, upd(800, `/start ${token}`));
    const u = upd(800, 'привіт');
    expect(await handleTelegramText({ repo, appUrl: APP }, u)).toBe(COPY.recorded);
    expect(await handleTelegramText({ repo, appUrl: APP }, { ...u })).toBeNull();
    const session = await repo.getOrCreateSessionForDay(me.user_id, localDay());
    expect((await repo.listMessages(session.id)).filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('/stop і DELETE /v1/telegram — відключають; текст після цього — «Спершу підключи…»; новий /start оживляє', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const { token } = await createTelegramLinkToken(repo, me.user_id, BOT);
    await handleTelegramText({ repo, appUrl: APP }, upd(900, `/start ${token}`));
    expect(await handleTelegramText({ repo, appUrl: APP }, upd(900, '/stop'))).toBe(COPY.stopped);
    expect(await handleTelegramText({ repo, appUrl: APP }, upd(900, 'привіт'))).toBe(COPY.linkFirst(APP));
    expect((await app.inject({ method: 'GET', url: '/v1/telegram', headers: { cookie: me.cookie } })).json()).toMatchObject({ linked: false });

    const { token: t2 } = await createTelegramLinkToken(repo, me.user_id, BOT);
    await handleTelegramText({ repo, appUrl: APP }, upd(900, `/start ${t2}`));
    expect((await app.inject({ method: 'GET', url: '/v1/telegram', headers: { cookie: me.cookie } })).json()).toMatchObject({ linked: true });
    const del = await app.inject({ method: 'DELETE', url: '/v1/telegram', headers: { cookie: me.cookie } });
    expect(del.json()).toEqual({ ok: true });
    expect(await handleTelegramText({ repo, appUrl: APP }, upd(900, 'ще раз'))).toBe(COPY.linkFirst(APP));
  });
});
