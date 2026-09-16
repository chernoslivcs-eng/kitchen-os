import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, PROFILE_SUMMARY_REQUEST } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { localDay } from '../src/local-day.js';

// Хотфікс 15.09: сервер більше НЕ вставляє вітання+картку онбордингу в GET
// /v1/session/today (session.ts, «Крок 7» знято) — після вимкнення екранів
// онбордингу воно спливало в кожному новому акаунті, а картка «Про тебе»
// у стрічці v3 уже не малюється (INTAKE_ON_WELCOME, №37), тож повідомлення
// лише заважало побачити шість підказок порожнього чату.
// PATCH /v1/onboarding/:id (пропуск панелі) і POST /v1/chat {action:
// 'profile_summary'} лишаються живими для СТАРИХ карток, уже в БД — тести
// нижче сіють таку картку напряму через repo.saveMessage, а не чекають, що
// її вставить сервер.

function mk() {
  const repo = new InMemoryRepo();
  const mailer = new ConsoleMailer();
  const app = buildApp(repo, new InMemoryStore(), mailer);
  return { repo, mailer, app };
}
type Msg = { id: string; role: string; text: string | null; card: { type: string; skipped?: string[] } | null };

/** Картка онбордингу, як її раніше вставляв сервер — тепер лише для тестів історичних даних. */
async function seedOnboardingCard(repo: InMemoryRepo, user_id: string): Promise<{ session_id: string; message_id: string }> {
  const session = await repo.getOrCreateSessionForDay(user_id, localDay());
  const message_id = randomUUID();
  await repo.saveMessage({
    id: message_id, session_id: session.id, role: 'assistant',
    text: null, card: { type: 'onboarding', skipped: [] }, applied: 0, created_at: new Date().toISOString(),
  });
  return { session_id: session.id, message_id };
}

describe('вітання й картка онбордингу зняті з GET /v1/session/today', () => {
  it('нова сесія, порожній профіль → messages: [] (не вставляє вітання)', async () => {
    const { repo, mailer, app } = mk();
    await app.ready();
    const me = await signIn(app, mailer, 'new@example.com');
    const r1 = await app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie } });
    expect((r1.json() as { messages: Msg[] }).messages).toEqual([]);
    // profile_onboarding_at лишається полем — просто ніхто його тут не виставляє.
    expect((await repo.getUser(me.user_id))?.profile_onboarding_at).toBeNull();

    const r2 = await app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie } });
    expect((r2.json() as { messages: Msg[] }).messages).toEqual([]);
  });

  it('профіль уже не порожній — той самий результат: messages: []', async () => {
    const a = mk(); await a.app.ready();
    const me = await signIn(a.app, a.mailer, 'filled@example.com');
    await a.repo.patchProfileField(me.user_id, 'love', { text: 'супи' });
    const r = await a.app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie } });
    expect((r.json() as { messages: Msg[] }).messages).toHaveLength(0);
  });
});

describe('PATCH /v1/onboarding/:message_id — лишається живим для карток, уже в БД', () => {
  it('{skip} → пропуск живе в картці й переживає перезавантаження', async () => {
    const { repo, mailer, app } = mk(); await app.ready();
    const me = await signIn(app, mailer, 'skip@example.com');
    const { message_id: id } = await seedOnboardingCard(repo, me.user_id);
    const s1 = await app.inject({ method: 'PATCH', url: `/v1/onboarding/${id}`, headers: { cookie: me.cookie }, payload: { skip: 'name' } });
    expect(s1.statusCode).toBe(200);
    expect(s1.json().card.skipped).toEqual(['name']);
    await app.inject({ method: 'PATCH', url: `/v1/onboarding/${id}`, headers: { cookie: me.cookie }, payload: { skip: 'name' } });
    const again = (await app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie } })).json() as { messages: Msg[] };
    expect(again.messages.find((m) => m.id === id)?.card?.skipped).toEqual(['name']);
    expect((await app.inject({ method: 'PATCH', url: `/v1/onboarding/${id}`, headers: { cookie: me.cookie }, payload: { skip: 'nope' } })).statusCode).toBe(400);
  });

  it('чужу картку не пропустити — 404', async () => {
    const { repo, mailer, app } = mk(); await app.ready();
    const me = await signIn(app, mailer, 'a@example.com');
    const other = await signIn(app, mailer, 'b@example.com');
    const { message_id: id } = await seedOnboardingCard(repo, me.user_id);
    const r = await app.inject({ method: 'PATCH', url: `/v1/onboarding/${id}`, headers: { cookie: other.cookie }, payload: { skip: 'name' } });
    expect(r.statusCode).toBe(404);
  });
});

describe('резюме «Показати, що вийшло»', () => {
  it('POST /v1/chat {action: profile_summary} → репліка без картки; user-повідомлення не пишеться', async () => {
    const { repo, mailer, app } = mk(); await app.ready();
    const me = await signIn(app, mailer, 'sum@example.com');
    const s = (await app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie } })).json() as { session: { id: string }; messages: Msg[] };
    await repo.patchProfileField(me.user_id, 'no', { text: 'мʼяса' });
    const before = (await repo.listMessages(s.session.id)).length;
    const r = await app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie }, payload: { session_id: s.session.id, action: 'profile_summary' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().card).toBeNull();
    expect(typeof r.json().reply).toBe('string');
    const after = await repo.listMessages(s.session.id);
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)).toMatchObject({ role: 'assistant', card: null });
    expect(after.some((m) => m.role === 'user' && m.text === PROFILE_SUMMARY_REQUEST)).toBe(false);
  });
});

describe('Семен на сервері', () => {
  it('PATCH /v1/me {welcome_seen:true} → welcome_seen_at у GET /v1/me', async () => {
    const { mailer, app } = mk(); await app.ready();
    const me = await signIn(app, mailer, 'w@example.com');
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: me.cookie } })).json().user.welcome_seen_at).toBeNull();
    const p = await app.inject({ method: 'PATCH', url: '/v1/me', headers: { cookie: me.cookie }, payload: { welcome_seen: true } });
    expect(p.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: me.cookie } })).json().user.welcome_seen_at).toBeTruthy();
  });
});
