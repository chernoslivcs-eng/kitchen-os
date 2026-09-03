// Адмінка v0: тільки той, чия пошта в ADMIN_EMAILS, і тільки чернетка → публікація.
//
// Гейт перевіряється окремо від CRUD — не тому, що це різні фічі, а тому, що
// найдорожчий баг тут не «форма зберегла криве поле», а «чужий побачив або
// торкнувся адмінки». Це перевіряється першим і найприскіпливіше.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';

describe('admin occasions · гейт', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let me: Signed;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer, {});
    me = await signIn(app, mailer, 'zvychayniy@x.local');
  });

  afterEach(() => { delete process.env.ADMIN_EMAILS; });

  it('ADMIN_EMAILS не задано — адмінки не існує навіть для залогіненого', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/admin/occasions', headers: { cookie: me.cookie } });
    expect(res.statusCode).toBe(404);
  });

  it('звичайна пошта не в списку — 404, не 403', async () => {
    process.env.ADMIN_EMAILS = 'owner@x.local';
    const res = await app.inject({ method: 'GET', url: '/v1/admin/occasions', headers: { cookie: me.cookie } });
    expect(res.statusCode).toBe(404);
  });

  it('пошта в списку (без урахування регістру) — доступ є', async () => {
    process.env.ADMIN_EMAILS = 'ZVYCHAYNIY@x.local, owner@x.local';
    const res = await app.inject({ method: 'GET', url: '/v1/admin/occasions', headers: { cookie: me.cookie } });
    expect(res.statusCode).toBe(200);
  });

  it('без сесії — 401 раніше, ніж 404: спершу авторизація, потім авторизація ролі', async () => {
    process.env.ADMIN_EMAILS = 'zvychayniy@x.local';
    const res = await app.inject({ method: 'GET', url: '/v1/admin/occasions' });
    expect(res.statusCode).toBe(401);
  });
});

describe('admin occasions · CRUD', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let admin: Signed;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer, {});
    admin = await signIn(app, mailer, 'admin@x.local');
    process.env.ADMIN_EMAILS = 'admin@x.local';
  });

  afterEach(() => { delete process.env.ADMIN_EMAILS; });

  const hdr = () => ({ cookie: admin.cookie });
  const valid = {
    id: 'tomato-day-2028', title: 'день томатів', meaning: 'Кінець сезону.',
    rule: { from: '09-05', to: '09-07' }, buy: ['томати'], seeds: [], source: 'Kitchen OS',
  };

  it('створення без обовʼязкового source — 400', async () => {
    const { source, ...rest } = valid;
    const res = await app.inject({ method: 'POST', url: '/v1/admin/occasions', headers: hdr(), payload: rest });
    expect(res.statusCode).toBe(400);
  });

  it('невалідний id (пробіл, великі літери) — 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/admin/occasions', headers: hdr(),
      payload: { ...valid, id: 'День Томатів!' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('невалідне вікно (не MM-DD) — 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/admin/occasions', headers: hdr(),
      payload: { ...valid, rule: { from: '2028-09-05', to: '09-07' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('створення → чернетка невидима звичайному календарю, потім публікація й вимкнення', async () => {
    const created = await app.inject({ method: 'POST', url: '/v1/admin/occasions', headers: hdr(), payload: valid });
    expect(created.statusCode).toBe(201);
    expect((created.json() as { occasion: { published_at: string | null } }).occasion.published_at).toBeNull();

    const before = await app.inject({ method: 'GET', url: '/v1/events?from=2028-09-01&to=2028-09-10', headers: hdr() });
    expect((before.json() as { events: { id: string }[] }).events.some((e) => e.id === valid.id)).toBe(false);

    const pub = await app.inject({ method: 'POST', url: `/v1/admin/occasions/${valid.id}/publish`, headers: hdr() });
    expect(pub.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/v1/events?from=2028-09-01&to=2028-09-10', headers: hdr() });
    expect((after.json() as { events: { id: string }[] }).events.some((e) => e.id === valid.id)).toBe(true);

    const unpub = await app.inject({ method: 'POST', url: `/v1/admin/occasions/${valid.id}/unpublish`, headers: hdr() });
    expect(unpub.statusCode).toBe(200);
    const gone = await app.inject({ method: 'GET', url: '/v1/events?from=2028-09-01&to=2028-09-10', headers: hdr() });
    expect((gone.json() as { events: { id: string }[] }).events.some((e) => e.id === valid.id)).toBe(false);
  });

  it('дублікат id — 409', async () => {
    await app.inject({ method: 'POST', url: '/v1/admin/occasions', headers: hdr(), payload: valid });
    const dup = await app.inject({ method: 'POST', url: '/v1/admin/occasions', headers: hdr(), payload: valid });
    expect(dup.statusCode).toBe(409);
  });

  it('правка не публікує сама собою', async () => {
    await app.inject({ method: 'POST', url: '/v1/admin/occasions', headers: hdr(), payload: valid });
    const patched = await app.inject({
      method: 'PATCH', url: `/v1/admin/occasions/${valid.id}`, headers: hdr(),
      payload: { title: 'день томатів (новий текст)' },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { occasion: { published_at: string | null } }).occasion.published_at).toBeNull();

    const list = await app.inject({ method: 'GET', url: '/v1/admin/occasions', headers: hdr() });
    const row = (list.json() as { occasions: { id: string; title: string }[] }).occasions.find((o) => o.id === valid.id);
    expect(row?.title).toBe('день томатів (новий текст)');
  });

  it('видалення прибирає з адмінського списку', async () => {
    await app.inject({ method: 'POST', url: '/v1/admin/occasions', headers: hdr(), payload: valid });
    const del = await app.inject({ method: 'DELETE', url: `/v1/admin/occasions/${valid.id}`, headers: hdr() });
    expect(del.statusCode).toBe(204);
    const list = await app.inject({ method: 'GET', url: '/v1/admin/occasions', headers: hdr() });
    expect((list.json() as { occasions: { id: string }[] }).occasions.some((o) => o.id === valid.id)).toBe(false);
  });

  it('дія над неіснуючим id — 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/admin/occasions/nema-takogo/publish', headers: hdr() });
    expect(res.statusCode).toBe(404);
  });
});
