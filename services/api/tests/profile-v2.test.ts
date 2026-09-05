import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { randomUUID } from 'node:crypto';
import { noteHash } from '@kitchen/domain';

// Раунд 4, крок 2 (AUDIT-ROUND-4.md §6): профіль як сім речень за прапором
// PROFILE_V2. Вимкнений прапор — поведінка API не змінюється взагалі.

function mk(profileV2: boolean) {
  const repo = new InMemoryRepo();
  const mailer = new ConsoleMailer();
  const app = buildApp(repo, new InMemoryStore(), mailer, { profileV2 });
  return { repo, mailer, app };
}

describe('PROFILE_V2 вимкнений (за замовчуванням)', () => {
  it('прапор читається з env: без PROFILE_V2 нові роути не існують, старий PATCH живе', async () => {
    delete process.env.PROFILE_V2;
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');

    const v2 = await app.inject({ method: 'PATCH', url: '/v1/profile/no', headers: { cookie: me.cookie }, payload: { text: 'риби' } });
    expect(v2.statusCode).toBe(404);

    const v1 = await app.inject({ method: 'PATCH', url: '/v1/profile', headers: { cookie: me.cookie }, payload: { ops: [{ op: 'add', kind: 'allergy', label: 'арахіс' }] } });
    expect(v1.statusCode).toBe(200);
    const got = await app.inject({ method: 'GET', url: '/v1/profile', headers: { cookie: me.cookie } });
    expect(got.json().profile.allergies).toEqual(['арахіс']);
    expect(got.json().fields).toBeUndefined();
  });
});

describe('PROFILE_V2 увімкнений', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let user_id: string;

  beforeEach(async () => {
    ({ repo, mailer, app } = mk(true));
    await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    cookie = me.cookie;
    user_id = me.user_id;
  });

  it('GET /v1/profile → сім полів, нотатки, база кухні', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/profile', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(Object.keys(body.fields)).toEqual(['name', 'no', 'ban', 'love', 'meh', 'kit', 'when']);
    expect(body.fields.no).toEqual({ text: '', status: 'empty', updated_at: null });
    expect(body.notes).toEqual([]);
    expect(body.defaults).toEqual({ kit: ['плита', 'духовка', 'мікрохвильовка', 'холодильник'] });
    expect(body.profile).toBeUndefined();
  });

  it('PATCH /v1/profile/:key {text} — автозбереження, обрізка по ліміту, вето-індекс поля у відповіді', async () => {
    const r = await app.inject({ method: 'PATCH', url: '/v1/profile/name', headers: { cookie }, payload: { text: ' ' + 'Пилип'.repeat(10) } });
    expect(r.statusCode).toBe(200);
    expect(r.json().field).toMatchObject({ text: 'Пилип'.repeat(6), status: 'filled' });
    expect(r.json().veto_index).toEqual([]);

    const got = await app.inject({ method: 'GET', url: '/v1/profile', headers: { cookie } });
    expect(got.json().fields.name.text).toBe('Пилип'.repeat(6));
  });

  it('PATCH /v1/profile/:key {status:none} — «Нічого такого»', async () => {
    const r = await app.inject({ method: 'PATCH', url: '/v1/profile/ban', headers: { cookie }, payload: { status: 'none' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().field).toMatchObject({ text: '', status: 'none' });
  });

  it('PATCH: невідомий ключ — 404, тіло без text/status — 400', async () => {
    expect((await app.inject({ method: 'PATCH', url: '/v1/profile/allergy', headers: { cookie }, payload: { text: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: '/v1/profile/no', headers: { cookie }, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/v1/profile/no', headers: { cookie }, payload: { status: 'filled' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/v1/profile/no', headers: { cookie }, payload: { text: 5 } })).statusCode).toBe(400);
  });

  it('PATCH без сесії — 401', async () => {
    expect((await app.inject({ method: 'PATCH', url: '/v1/profile/no', payload: { text: 'x' } })).statusCode).toBe(401);
  });

  it('нотатки: GET віддає останні не видалені; DELETE — мʼяко; POST restore — повертає', async () => {
    const id = randomUUID();
    await repo.addProfileNote({ id, user_id, subject: null, text: 'Духовка гріє сильніше', source: 'assistant', created_at: '2026-09-02T10:00:00.000Z', deleted_at: null, norm_hash: noteHash('Духовка гріє сильніше') });

    let got = await app.inject({ method: 'GET', url: '/v1/profile', headers: { cookie } });
    expect(got.json().notes).toEqual([{ id, text: 'Духовка гріє сильніше', source: 'assistant', created_at: '2026-09-02T10:00:00.000Z' }]);

    const del = await app.inject({ method: 'DELETE', url: `/v1/profile/notes/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
    got = await app.inject({ method: 'GET', url: '/v1/profile', headers: { cookie } });
    expect(got.json().notes).toEqual([]);
    expect((await repo.listProfileNotes(user_id, { include_deleted: true }))[0]?.deleted_at).toBeTruthy();

    const restore = await app.inject({ method: 'POST', url: `/v1/profile/notes/${id}/restore`, headers: { cookie } });
    expect(restore.statusCode).toBe(200);
    expect(restore.json().note).toMatchObject({ id, text: 'Духовка гріє сильніше' });
    got = await app.inject({ method: 'GET', url: '/v1/profile', headers: { cookie } });
    expect(got.json().notes).toHaveLength(1);
  });

  it('чужу нотатку не прибрати й не повернути — 404', async () => {
    const other = await signIn(app, mailer, 'other@example.com');
    const id = randomUUID();
    await repo.addProfileNote({ id, user_id: other.user_id, subject: null, text: 'чужа', source: 'assistant', created_at: new Date().toISOString(), deleted_at: null, norm_hash: noteHash('чужа') });
    expect((await app.inject({ method: 'DELETE', url: `/v1/profile/notes/${id}`, headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/v1/profile/notes/${id}/restore`, headers: { cookie } })).statusCode).toBe(404);
    expect((await repo.listProfileNotes(other.user_id)).map((n) => n.id)).toEqual([id]);
  });

  it('старі ендпоінти профілю — 410', async () => {
    const p = await app.inject({ method: 'PATCH', url: '/v1/profile', headers: { cookie }, payload: { ops: [{ op: 'add', kind: 'allergy', label: 'арахіс' }] } });
    expect(p.statusCode).toBe(410);
    const n = await app.inject({ method: 'DELETE', url: `/v1/notes/${randomUUID()}`, headers: { cookie } });
    expect(n.statusCode).toBe(410);
    expect(await repo.getProfile(user_id)).toBeNull();
  });
});

describe('їдці — поза прапором', () => {
  it('DELETE /v1/eaters/:id працює і з увімкненим PROFILE_V2', async () => {
    const { repo, mailer, app } = mk(true);
    await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    const id = randomUUID();
    await repo.insertEater({ id, household_id: me.household_id, name: 'Оксана', allergies: [], wishes: [], antipatterns: [], created_at: new Date().toISOString() });
    expect((await app.inject({ method: 'DELETE', url: `/v1/eaters/${id}`, headers: { cookie: me.cookie } })).statusCode).toBe(204);
    expect(await repo.listEaters(me.household_id)).toEqual([]);
  });
});
