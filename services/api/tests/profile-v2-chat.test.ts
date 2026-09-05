import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { buildDynamicContext } from '../src/model.js';
import { summarizeCard, buildChatHistory } from '../src/chat-history.js';
import { InMemoryRepo, createPending, emptyProfileText, type ProfileCard, type MessageRow } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

// Раунд 4, крок 3: під PROFILE_V2 модель читає [ПРО ЛЮДИНУ] + [НОТАТКИ]
// замість [ПРОФІЛЬ] + [ВИСНОВКИ]/[НАМІРИ]; картка поля застосовується через
// той самий /v1/cards/:id/apply, «Нічого такого» — тілом {none:true}.

const base = { user_id: 'u1', session_id: 's1', text: 'що на вечерю', pantry: [] };

describe('динамічний контекст', () => {
  it('без profileText — старий [ПРОФІЛЬ] і [ВИСНОВКИ]; з ним — [ПРО ЛЮДИНУ] на тому самому місці', () => {
    const old = buildDynamicContext({ ...base, profile: { user_id: 'u1', allergies: ['арахіс'], wishes: [], antipatterns: [], equipment: {} } });
    expect(old).toContain('[ПРОФІЛЬ]');
    expect(old).toContain('[ВИСНОВКИ З ГОТУВАННЯ]');
    expect(old).not.toContain('[ПРО ЛЮДИНУ');

    const p = emptyProfileText('u1');
    p.fields.no = { text: 'мʼяса й птиці', status: 'filled', updated_at: null };
    const v2 = buildDynamicContext({ ...base, profileText: p, profileNotes: [] });
    expect(v2.indexOf('[ПРО ЛЮДИНУ — її власні слова]')).toBe(2);
    expect(v2).toContain('Я не їм мʼяса й птиці.');
    expect(v2).toContain('[НОТАТКИ — записав сам після розмов і готувань]');
    expect(v2).not.toContain('[ПРОФІЛЬ]');
    expect(v2).not.toContain('[ВИСНОВКИ З ГОТУВАННЯ]');
    expect(v2).not.toContain('[НАМІРИ]');
    expect(v2.indexOf('[СЬОГОДНІ]')).toBeGreaterThan(v2.indexOf('[НОТАТКИ'));
  });

  it('традиції під v2 — окремим блоком, лише коли обрано', () => {
    const p = emptyProfileText('u1');
    const none = buildDynamicContext({ ...base, profileText: p, profile: { user_id: 'u1', allergies: [], wishes: [], antipatterns: [], equipment: {}, traditions: null } });
    expect(none).not.toContain('[ТРАДИЦІЇ]');
    const off = buildDynamicContext({ ...base, profileText: p, profile: { user_id: 'u1', allergies: [], wishes: [], antipatterns: [], equipment: {}, traditions: [] } });
    expect(off).toContain('[ТРАДИЦІЇ] вимкнено');
  });
});

describe('історія розмови', () => {
  it('картка поля в історії: «записав у „…": …» і кнопка «Записати»', () => {
    const card: ProfileCard = { type: 'profile', field: 'no', mode: 'append', text: 'селери' };
    expect(summarizeCard(card)).toBe('[картка: профіль] записав у „Я не їм": селери');
    const msg: MessageRow = { id: 'm1', session_id: 's1', role: 'assistant', text: 'Запишу.', card, applied: 0, created_at: '2026-09-05T10:00:00.000Z' };
    const [turn] = buildChatHistory([msg]);
    expect(turn!.content).toContain('кнопка «Записати»');
  });
});

describe('/v1/cards/:id/apply під прапором', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer, { profileV2: true });
    await app.ready();
  });

  const pend = async (user_id: string, household_id: string, card: ProfileCard) => {
    const message_id = randomUUID();
    await createPending(repo, { message_id, household_id, user_id, card });
    return message_id;
  };

  it('append → поле записано, undo повертає', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const id = await pend(me.user_id, me.household_id, { type: 'profile', field: 'love', mode: 'append', text: 'супи' });
    const r = await app.inject({ method: 'POST', url: `/v1/cards/${id}/apply`, headers: { cookie: me.cookie }, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ applied: 1, truncated: false });
    expect((await repo.getProfileText(me.user_id)).fields.love.text).toBe('супи');
    const u = await app.inject({ method: 'POST', url: `/v1/cards/${id}/undo`, headers: { cookie: me.cookie }, payload: { undo_token: r.json().undo_token } });
    expect(u.statusCode).toBe(200);
    expect((await repo.getProfileText(me.user_id)).fields.love.status).toBe('empty');
  });

  it('{none:true} на ban → status none; на іншому полі — 409', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const ban = await pend(me.user_id, me.household_id, { type: 'profile', field: 'ban', mode: 'replace', text: '', onboarding: true });
    const r = await app.inject({ method: 'POST', url: `/v1/cards/${ban}/apply`, headers: { cookie: me.cookie }, payload: { none: true } });
    expect(r.statusCode).toBe(200);
    expect((await repo.getProfileText(me.user_id)).fields.ban.status).toBe('none');

    const no = await pend(me.user_id, me.household_id, { type: 'profile', field: 'no', mode: 'replace', text: '', onboarding: true });
    const bad = await app.inject({ method: 'POST', url: `/v1/cards/${no}/apply`, headers: { cookie: me.cookie }, payload: { none: true } });
    expect(bad.statusCode).toBe(409);
  });

  it('без прапора картка поля дає 409, а не 500', async () => {
    const off = buildApp(repo, new InMemoryStore(), mailer, { profileV2: false });
    await off.ready();
    const me = await signIn(off, mailer, 'me@example.com');
    const id = await pend(me.user_id, me.household_id, { type: 'profile', field: 'no', mode: 'append', text: 'селери' });
    const r = await off.inject({ method: 'POST', url: `/v1/cards/${id}/apply`, headers: { cookie: me.cookie }, payload: {} });
    expect(r.statusCode).toBe(409);
  });
});
