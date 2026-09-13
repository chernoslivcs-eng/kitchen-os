// Р147/Р149 (TELEGRAM-PLAN-0913, PR 1–2): привʼязка (токен разовий, 15 хв), текст →
// ТОЙ САМИЙ хід чату, що /v1/chat (user + assistant у сесію дня з channel), картка →
// текст, помилка → E1, /stop, дубль update_id, контракт профілю. Модель — стаб.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, type Card } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import {
  handleTelegramText, createTelegramLinkToken, resetSeenUpdates, resetBotUsernameCache,
  renderCardText, renderTurnMessages, splitTelegramText, escapeHtml, COPY, TELEGRAM_LINK_TTL_MS,
} from '../src/telegram.js';
import { ChatTurnHttpError } from '../src/chat-turn.js';
import { localDay } from '../src/local-day.js';

const APP = 'https://kos.example';
const BOT = 'KitchenOSBot';

describe('Р147/Р149 · Telegram', () => {
  let repo: InMemoryRepo; let mailer: ConsoleMailer; let store: InMemoryStore; let app: ReturnType<typeof buildApp>;
  let seq = 0;
  const upd = (telegram_user_id: number, text: string, chat_id = telegram_user_id) => ({ update_id: ++seq, telegram_user_id, chat_id, text });
  const deps = (extra: Record<string, unknown> = {}) => ({ repo, store, appUrl: APP, ...extra });
  beforeEach(async () => {
    repo = new InMemoryRepo(); mailer = new ConsoleMailer(); store = new InMemoryStore(); resetSeenUpdates(); resetBotUsernameCache();
    process.env.TELEGRAM_BOT_USERNAME = BOT;
    app = buildApp(repo, store, mailer);
    await app.ready();
  });
  const get = (cookie: string) => app.inject({ method: 'GET', url: '/v1/telegram', headers: { cookie } });
  async function linked(email = 'me@example.com', tgId = 500) {
    const me = await signIn(app, mailer, email);
    const { token } = await createTelegramLinkToken(repo, me.user_id, BOT);
    await handleTelegramText(deps(), upd(tgId, `/start ${token}`));
    return me;
  }

  it('без username (нема env і токена) — link-token → 503, GET username null', async () => {
    delete process.env.TELEGRAM_BOT_USERNAME; delete process.env.TELEGRAM_BOT_TOKEN;
    const me = await signIn(app, mailer, 'me@example.com');
    expect((await get(me.cookie)).json()).toEqual({ linked: false, username: null, linked_at: null });
    const tok = await app.inject({ method: 'POST', url: '/v1/telegram/link-token', headers: { cookie: me.cookie, 'content-type': 'application/json' }, payload: '{}' });
    expect(tok.statusCode).toBe(503);
  });

  it('/start без токена або з чужим — «Спершу підключи…»; текст від непривʼязаного — те саме', async () => {
    expect(await handleTelegramText(deps(), upd(100, '/start'))).toEqual({ messages: [COPY.linkFirst(APP)], html: false });
    expect(await handleTelegramText(deps(), upd(100, '/start nope'))).toEqual({ messages: [COPY.linkFirst(APP)], html: false });
    expect(await handleTelegramText(deps(), upd(100, 'привіт'))).toEqual({ messages: [COPY.linkFirst(APP)], html: false });
  });

  it('контракт профілю: GET → { linked, username, linked_at }; POST link-token → { url, expires_at }; /start <token> → привʼязка; токен разовий', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    expect((await get(me.cookie)).json()).toEqual({ linked: false, username: BOT, linked_at: null });
    const tok = await app.inject({ method: 'POST', url: '/v1/telegram/link-token', headers: { cookie: me.cookie, 'content-type': 'application/json' }, payload: '{}' });
    const body = tok.json() as { url: string; expires_at: string };
    expect(Object.keys(body).sort()).toEqual(['expires_at', 'url']);
    expect(body.url).toMatch(new RegExp(`^https://t\\.me/${BOT}\\?start=[A-Za-z0-9_-]+$`));
    const token = decodeURIComponent(body.url.split('start=')[1]!);
    const reply = await handleTelegramText(deps(), upd(500, `/start ${token}`, 777));
    expect(reply?.messages[0]).toMatch(/^Привіт, .*Це кухня дому/);
    expect(await repo.getTelegramByTelegramUser(500)).toMatchObject({ user_id: me.user_id, chat_id: 777, revoked_at: null });
    expect((await get(me.cookie)).json()).toMatchObject({ linked: true, username: BOT });
    expect(await handleTelegramText(deps(), upd(501, `/start ${token}`))).toEqual({ messages: [COPY.linkFirst(APP)], html: false });
  });

  it('токен живе 15 хвилин', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const t0 = new Date('2026-09-13T10:00:00Z');
    const { token } = await createTelegramLinkToken(repo, me.user_id, BOT, t0);
    const late = new Date(t0.getTime() + TELEGRAM_LINK_TTL_MS + 1000);
    expect(await handleTelegramText(deps({ now: () => late }), upd(600, `/start ${token}`))).toEqual({ messages: [COPY.linkFirst(APP)], html: false });
    const { token: t2 } = await createTelegramLinkToken(repo, me.user_id, BOT, t0);
    const inTime = new Date(t0.getTime() + TELEGRAM_LINK_TTL_MS - 1000);
    expect((await handleTelegramText(deps({ now: () => inTime }), upd(601, `/start ${t2}`)))?.messages[0]).toMatch(/^Привіт/);
  });

  it('текст привʼязаного → той самий хід, що /v1/chat: user і assistant у сесії дня з channel telegram; веб бачить channel; відповідь HTML + «Відкрити у вебі»', async () => {
    const me = await linked();
    const reply = await handleTelegramText(deps(), upd(500, 'купив молоко і хліб'));
    expect(reply?.html).toBe(true);
    expect(reply?.messages.at(-1)).toContain(COPY.openWeb(APP));
    const session = await repo.getOrCreateSessionForDay(me.user_id, localDay());
    const msgs = await repo.listMessages(session.id);
    const user = msgs.filter((m) => m.role === 'user');
    const bot = msgs.filter((m) => m.role === 'assistant' && m.text !== null);
    expect(user).toHaveLength(1);
    expect(user[0]).toMatchObject({ text: 'купив молоко і хліб', channel: 'telegram' });
    expect(bot.length, 'відповідь стаба моделі записана').toBeGreaterThanOrEqual(1);
    expect(bot.at(-1)?.channel).toBe('telegram');
    expect((await repo.getSession(session.id))?.title).toBeTruthy();
    const web = await app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie } });
    const shown = (web.json() as { messages: { role: string; channel?: string }[] }).messages.filter((m) => m.channel === 'telegram');
    expect(shown.map((m) => m.role)).toEqual(expect.arrayContaining(['user', 'assistant']));
  });

  it('хід через /v1/chat з вебу — без channel (web не возиться)', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie, 'content-type': 'application/json' }, payload: { text: 'привіт' } });
    const session = await repo.getOrCreateSessionForDay(me.user_id, localDay());
    for (const m of await repo.listMessages(session.id)) expect(m.channel).toBeUndefined();
  });

  it('картка → текст: proposal, recipe, intake_diff, shopping; невідома — null; екранування й розбиття', () => {
    const proposal: Card = { type: 'proposal', items: [{ title: 'Паста', desc: '20 хв' }, { title: 'Омлет', desc: '10 хв' }] };
    expect(renderCardText(proposal)).toBe('Варіанти:\n1) Паста · 20 хв\n2) Омлет · 10 хв');
    const recipe: Card = { type: 'recipe', recipe: { t: 'Паста з томатами', sv: 2, tm: 20, ch: '', d: '', rk: '', ing: [{ p: 'паста', v: 200, u: 'g' }, { n: 'сіль' }], st: [] } };
    expect(renderCardText(recipe)).toBe('Паста з томатами · 20 хв · 2 порц.\n— паста · 200 g\n— сіль');
    const intake: Card = { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко', value: 1, unit: 'ml' }, { op: 'deplete', label: 'хліб' }] };
    expect(renderCardText(intake)).toBe('Розібрав: 2 позиції\n+ молоко · 1 ml\n− хліб');
    const shopping: Card = { type: 'shopping', items: [{ op: 'add', label: 'яйця', v: 10, u: 'pcs' }, { op: 'remove', label: 'сіль' }] };
    expect(renderCardText(shopping)).toBe('Список:\n+ яйця · 10 pcs\n− сіль');
    expect(renderCardText({ type: 'cook_go', title: 'x' })).toBeNull();
    const msgs = renderTurnMessages({ reply: 'a < b & c', card: proposal }, APP);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toBe(`a &lt; b &amp; c\n\n${escapeHtml(renderCardText(proposal)!)}\n\n${escapeHtml(COPY.openWeb(APP))}`);
    const long = Array.from({ length: 300 }, (_, i) => `рядок ${i} ${'x'.repeat(20)}`).join('\n');
    const parts = splitTelegramText(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(4096);
    expect(parts.join('\n')).toBe(long);
  });

  it('помилка ходу (502 model_unavailable або виняток) → текст E1, обидві сторони живі', async () => {
    await linked();
    const fail = deps({ turn: async () => { throw new ChatTurnHttpError(502, { error: 'model_unavailable' }); } });
    expect(await handleTelegramText(fail, upd(500, 'що на вечерю'))).toEqual({ messages: [COPY.replyFailed], html: false });
    const boom = deps({ turn: async () => { throw new Error('boom'); } });
    expect(await handleTelegramText(boom, upd(500, 'що на вечерю'))).toEqual({ messages: [COPY.replyFailed], html: false });
  });

  it('дубль update_id — ігнорується, другого ходу нема', async () => {
    const me = await linked();
    const u = upd(500, 'привіт');
    expect((await handleTelegramText(deps(), u))?.html).toBe(true);
    expect(await handleTelegramText(deps(), { ...u })).toBeNull();
    const session = await repo.getOrCreateSessionForDay(me.user_id, localDay());
    expect((await repo.listMessages(session.id)).filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('/stop і DELETE /v1/telegram — відключають; текст після цього — «Спершу підключи…»; новий /start оживляє', async () => {
    const me = await linked();
    expect(await handleTelegramText(deps(), upd(500, '/stop'))).toEqual({ messages: [COPY.stopped], html: false });
    expect(await handleTelegramText(deps(), upd(500, 'привіт'))).toEqual({ messages: [COPY.linkFirst(APP)], html: false });
    expect((await get(me.cookie)).json()).toMatchObject({ linked: false });
    const { token: t2 } = await createTelegramLinkToken(repo, me.user_id, BOT);
    await handleTelegramText(deps(), upd(500, `/start ${t2}`));
    expect((await get(me.cookie)).json()).toMatchObject({ linked: true });
    const del = await app.inject({ method: 'DELETE', url: '/v1/telegram', headers: { cookie: me.cookie } });
    expect(del.json()).toEqual({ ok: true });
    expect(await handleTelegramText(deps(), upd(500, 'ще раз'))).toEqual({ messages: [COPY.linkFirst(APP)], html: false });
  });
});
