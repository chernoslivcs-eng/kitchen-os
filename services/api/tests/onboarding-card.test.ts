import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, ONBOARDING_GREETING, PROFILE_SUMMARY_REQUEST } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

// Раунд 4, крок 7: картка «Про тебе» в стрічці. Видається один раз — у першій
// розмові, коли всі сім полів порожні; стан панелей — з profile_text, пропуски
// — у самій картці; резюме — серверний хід без картки.

function mk(profileV2: boolean) {
  const repo = new InMemoryRepo();
  const mailer = new ConsoleMailer();
  const app = buildApp(repo, new InMemoryStore(), mailer, { profileV2 });
  return { repo, mailer, app };
}
type Msg = { id: string; role: string; text: string | null; card: { type: string; skipped?: string[] } | null };

describe('видача картки онбордингу', () => {
  it('перший GET /v1/session/today → вітання + картка onboarding; другий — без дубля; прапорець у користувача', async () => {
    const { repo, mailer, app } = mk(true);
    await app.ready();
    const me = await signIn(app, mailer, 'new@example.com');
    const r1 = await app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie } });
    const m1 = (r1.json() as { messages: Msg[] }).messages;
    expect(m1).toHaveLength(1);
    expect(m1[0]).toMatchObject({ role: 'assistant', text: ONBOARDING_GREETING, card: { type: 'onboarding' } });
    expect((await repo.getUser(me.user_id))?.profile_onboarding_at).toBeTruthy();

    const r2 = await app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie } });
    expect((r2.json() as { messages: Msg[] }).messages.filter((m) => m.card?.type === 'onboarding')).toHaveLength(1);
  });

  it('профіль уже не порожній → картки нема; без прапора — нема', async () => {
    const a = mk(true); await a.app.ready();
    const me = await signIn(a.app, a.mailer, 'filled@example.com');
    await a.repo.patchProfileField(me.user_id, 'love', { text: 'супи' });
    const r = await a.app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie } });
    expect((r.json() as { messages: Msg[] }).messages).toHaveLength(0);

    const b = mk(false); await b.app.ready();
    const me2 = await signIn(b.app, b.mailer, 'v1@example.com');
    const r2 = await b.app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie: me2.cookie } });
    expect((r2.json() as { messages: Msg[] }).messages).toHaveLength(0);
  });

  it('PATCH /v1/onboarding/:message_id {skip} → пропуск живе в картці й переживає перезавантаження', async () => {
    const { mailer, app } = mk(true); await app.ready();
    const me = await signIn(app, mailer, 'skip@example.com');
    const first = (await app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie } })).json() as { messages: Msg[] };
    const id = first.messages[0]!.id;
    const s1 = await app.inject({ method: 'PATCH', url: `/v1/onboarding/${id}`, headers: { cookie: me.cookie }, payload: { skip: 'name' } });
    expect(s1.statusCode).toBe(200);
    expect(s1.json().card.skipped).toEqual(['name']);
    await app.inject({ method: 'PATCH', url: `/v1/onboarding/${id}`, headers: { cookie: me.cookie }, payload: { skip: 'name' } });
    const again = (await app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie } })).json() as { messages: Msg[] };
    expect(again.messages[0]!.card?.skipped).toEqual(['name']);
    expect((await app.inject({ method: 'PATCH', url: `/v1/onboarding/${id}`, headers: { cookie: me.cookie }, payload: { skip: 'nope' } })).statusCode).toBe(400);
  });

  it('чужу картку не пропустити — 404', async () => {
    const { mailer, app } = mk(true); await app.ready();
    const me = await signIn(app, mailer, 'a@example.com');
    const other = await signIn(app, mailer, 'b@example.com');
    const first = (await app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie } })).json() as { messages: Msg[] };
    const r = await app.inject({ method: 'PATCH', url: `/v1/onboarding/${first.messages[0]!.id}`, headers: { cookie: other.cookie }, payload: { skip: 'name' } });
    expect(r.statusCode).toBe(404);
  });
});

describe('резюме «Показати, що вийшло»', () => {
  it('POST /v1/chat {action: profile_summary} → репліка без картки; user-повідомлення не пишеться', async () => {
    const { repo, mailer, app } = mk(true); await app.ready();
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
    const { mailer, app } = mk(true); await app.ready();
    const me = await signIn(app, mailer, 'w@example.com');
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: me.cookie } })).json().user.welcome_seen_at).toBeNull();
    const p = await app.inject({ method: 'PATCH', url: '/v1/me', headers: { cookie: me.cookie }, payload: { welcome_seen: true } });
    expect(p.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: me.cookie } })).json().user.welcome_seen_at).toBeTruthy();
  });
});
