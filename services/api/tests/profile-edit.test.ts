import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

// Профіль був доступний тільки для читання: наповнити його можна було лише
// розмовою, а виправити помилку моделі — теж лише розмовою. Якщо «не люблю
// кінзу» лягло в алергії, зняти це не було чим.
//
// Головне правило продукту не порушено: воно про те, що в стан не пише МОДЕЛЬ.
// Тут пише людина у своєму профілі, через інтерфейс.

describe('правка профілю руками', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  const patch = (cookie: string, ops: unknown[]) =>
    app.inject({ method: 'PATCH', url: '/v1/profile', headers: { cookie }, payload: { ops } });

  it('додає алергію й вона одразу в GET', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const r = await patch(me.cookie, [{ op: 'add', kind: 'allergy', label: 'арахіс' }]);
    expect(r.statusCode).toBe(200);
    expect(r.json().applied).toBe(1);

    const got = await app.inject({ method: 'GET', url: '/v1/profile', headers: { cookie: me.cookie } });
    expect(got.json().profile.allergies).toEqual(['арахіс']);
  });

  it('прибирає помилково записану алергію', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await patch(me.cookie, [{ op: 'add', kind: 'allergy', label: 'кінза' }]);
    const r = await patch(me.cookie, [{ op: 'remove', kind: 'allergy', label: 'кінза' }]);
    expect(r.json().applied).toBe(1);
    expect(r.json().profile.allergies).toEqual([]);
  });

  it('переносить запис між блоками двома операціями в одному запиті', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await patch(me.cookie, [{ op: 'add', kind: 'allergy', label: 'кінза' }]);
    const r = await patch(me.cookie, [
      { op: 'remove', kind: 'allergy', label: 'кінза' },
      { op: 'add', kind: 'anti', label: 'не люблю кінзу' },
    ]);
    expect(r.json().applied).toBe(2);
    expect(r.json().profile.allergies).toEqual([]);
    expect(r.json().profile.antipatterns).toEqual(['не люблю кінзу']);
  });

  it('дубль не рахується', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await patch(me.cookie, [{ op: 'add', kind: 'wish', label: 'більше риби' }]);
    const r = await patch(me.cookie, [{ op: 'add', kind: 'wish', label: 'більше риби' }]);
    expect(r.json().applied).toBe(0);
    expect(r.json().profile.wishes).toEqual(['більше риби']);
  });

  it('прибирає запис про техніку', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await patch(me.cookie, [{ op: 'add', kind: 'equip', label: 'духовка', has: false }]);
    const r = await patch(me.cookie, [{ op: 'remove', kind: 'equip', label: 'духовка' }]);
    expect(r.json().applied).toBe(1);
    expect(r.json().profile.equipment).toEqual({});
  });

  it('невідомий kind — 400, а не тиха втрата', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const r = await patch(me.cookie, [{ op: 'add', kind: 'member', label: 'Оксана' }]);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('bad_kind');
  });

  it('порожній label — 400', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    expect((await patch(me.cookie, [{ op: 'add', kind: 'wish', label: '  ' }])).statusCode).toBe(400);
  });

  it('порожній список операцій — 400', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    expect((await patch(me.cookie, [])).statusCode).toBe(400);
  });

  // Одна погана операція скасовує весь запит: часткове застосування зробило б
  // стан на екрані й у базі різним, і людина б цього не побачила.
  it('валідація до запису: жодна операція з поганої пачки не лягає', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await patch(me.cookie, [
      { op: 'add', kind: 'wish', label: 'більше риби' },
      { op: 'add', kind: 'нісенітниця', label: 'x' },
    ]);
    const got = await app.inject({ method: 'GET', url: '/v1/profile', headers: { cookie: me.cookie } });
    expect(got.json().profile.wishes).toEqual([]);
  });

  it('без auth — 401', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/v1/profile', payload: { ops: [{ op: 'add', kind: 'wish', label: 'x' }] },
    });
    expect(r.statusCode).toBe(401);
  });

  it('профілі не течуть між юзерами', async () => {
    const alice = await signIn(app, mailer, 'alice@example.com');
    const bob = await signIn(app, mailer, 'bob@example.com');
    await patch(alice.cookie, [{ op: 'add', kind: 'allergy', label: 'арахіс' }]);
    const got = await app.inject({ method: 'GET', url: '/v1/profile', headers: { cookie: bob.cookie } });
    expect(got.json().profile.allergies).toEqual([]);
  });
});

describe('висновки в профілі', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  async function addNote(user_id: string, text: string) {
    const id = crypto.randomUUID();
    await repo.insertNote({
      id, user_id, text, recipe_title: null, rating: null,
      pinned: false, created_at: new Date().toISOString(),
    });
    return id;
  }

  it('GET /v1/profile віддає висновки', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await addNote(me.user_id, 'фует знімати, щойно краї хрусткі');
    const got = await app.inject({ method: 'GET', url: '/v1/profile', headers: { cookie: me.cookie } });
    expect(got.json().notes).toHaveLength(1);
    expect(got.json().notes[0].text).toBe('фует знімати, щойно краї хрусткі');
  });

  it('DELETE знімає висновок', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const id = await addNote(me.user_id, 'менше солі');
    const del = await app.inject({ method: 'DELETE', url: `/v1/notes/${id}`, headers: { cookie: me.cookie } });
    expect(del.statusCode).toBe(204);
    expect(await repo.listNotes(me.user_id)).toHaveLength(0);
  });

  it('чужий висновок не видалити — 404', async () => {
    const alice = await signIn(app, mailer, 'alice@example.com');
    const bob = await signIn(app, mailer, 'bob@example.com');
    const id = await addNote(alice.user_id, 'мій висновок');
    const del = await app.inject({ method: 'DELETE', url: `/v1/notes/${id}`, headers: { cookie: bob.cookie } });
    expect(del.statusCode).toBe(404);
    expect(await repo.listNotes(alice.user_id)).toHaveLength(1);
  });
});
