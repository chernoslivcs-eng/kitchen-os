import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

// Двоє в домі: A запрошує B → B клікає лінк → B створений/залогінений, у household_member A.
// Плюс паралельні гілки: чужа сесія не може запросити; revoke ламає лінк;
// повторне accept — 410; уже член дому — теж працює (idempotent), але з прапорцем.

describe('household invite', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('A запрошує B → B клікає лінк → B пише в комору дому A, без свого', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    mailer.sent.length = 0;

    const inv = await app.inject({
      method: 'POST',
      url: `/v1/households/${A.household_id}/invite`,
      headers: { cookie: A.cookie },
      payload: { email: 'b@example.com' },
    });
    expect(inv.statusCode).toBe(201);
    const invBody = inv.json();
    expect(invBody.email).toBe('b@example.com');

    const url = new URL(mailer.last()!.link);
    const accept = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
    expect(accept.statusCode).toBe(200);
    const body = accept.json();
    expect(body.household_id).toBe(A.household_id);
    expect(body.already_member).toBe(false);

    // Гість — B — існує в домі A, і БІЛЬШЕ ніде. Свого дому в нього нема.
    expect(await repo.isMember(A.household_id, body.user_id)).toBe(true);
    expect(await repo.firstHouseholdOf(body.user_id)).toBe(A.household_id);

    // B пише в комору через свою cookie — вона має вести в дім A, не в порожній свій.
    const setCookie = accept.headers['set-cookie']!;
    const bCookieRaw = Array.isArray(setCookie) ? setCookie[0]! : setCookie;
    const bCookie = bCookieRaw.split(';')[0]!;
    const chat = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { cookie: bCookie },
      payload: { session_id: 's', text: 'купив пармезан' },
    });
    expect(chat.statusCode).toBe(200);
    const { card_id } = chat.json();
    await app.inject({
      method: 'POST',
      url: `/v1/cards/${card_id}/apply`,
      headers: { cookie: bCookie },
      payload: {},
    });
    // Пармезан ліг у комору A, а не в якийсь окремий дім B.
    const batches = await repo.listBatches(A.household_id);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.label.toLowerCase()).toContain('пармезан');
  });

  it('чужа сесія не може запросити в дім, до якого не належить', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const C = await signIn(app, mailer, 'c@example.com');   // C — не в домі A
    const inv = await app.inject({
      method: 'POST',
      url: `/v1/households/${A.household_id}/invite`,
      headers: { cookie: C.cookie },
      payload: { email: 'b@example.com' },
    });
    expect(inv.statusCode).toBe(403);
  });

  it('revoke ламає лінк — accept повертає 410', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    mailer.sent.length = 0;
    const inv = await app.inject({
      method: 'POST',
      url: `/v1/households/${A.household_id}/invite`,
      headers: { cookie: A.cookie },
      payload: { email: 'b@example.com' },
    });
    const { id } = inv.json();
    const link = mailer.last()!.link;

    const rev = await app.inject({
      method: 'POST',
      url: `/v1/invites/${id}/revoke`,
      headers: { cookie: A.cookie },
    });
    expect(rev.statusCode).toBe(204);

    const url = new URL(link);
    const accept = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
    expect(accept.statusCode).toBe(410);
    expect(accept.json().error).toBe('revoked');
  });

  it('одноразовість: другий клік лінку — 410', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    mailer.sent.length = 0;
    await app.inject({
      method: 'POST',
      url: `/v1/households/${A.household_id}/invite`,
      headers: { cookie: A.cookie },
      payload: { email: 'b@example.com' },
    });
    const url = new URL(mailer.last()!.link);
    const first = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
    expect(second.statusCode).toBe(410);
  });

  it('revoke чужого — 403', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const C = await signIn(app, mailer, 'c@example.com');
    mailer.sent.length = 0;
    const inv = await app.inject({
      method: 'POST',
      url: `/v1/households/${A.household_id}/invite`,
      headers: { cookie: A.cookie },
      payload: { email: 'b@example.com' },
    });
    const { id } = inv.json();
    const rev = await app.inject({
      method: 'POST',
      url: `/v1/invites/${id}/revoke`,
      headers: { cookie: C.cookie },
    });
    expect(rev.statusCode).toBe(403);
  });

  it('accept з битим token — 404', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/invites/accept?token=nonsense' });
    expect(r.statusCode).toBe(404);
  });

  it('запрошення без валідного email — 400', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const inv = await app.inject({
      method: 'POST',
      url: `/v1/households/${A.household_id}/invite`,
      headers: { cookie: A.cookie },
      payload: { email: 'not-an-email' },
    });
    expect(inv.statusCode).toBe(400);
  });

  it('запрошення без сесії — 401', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const inv = await app.inject({
      method: 'POST',
      url: `/v1/households/${A.household_id}/invite`,
      payload: { email: 'b@example.com' },
    });
    expect(inv.statusCode).toBe(401);
  });

  it('запрошений уже член дому — приймає й показує already_member=true', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const B = await signIn(app, mailer, 'b@example.com');
    // Ручно додаємо B у дім A — імітуємо попереднє прийняте запрошення
    await repo.addMember(A.household_id, B.user_id, 'member');
    mailer.sent.length = 0;

    await app.inject({
      method: 'POST',
      url: `/v1/households/${A.household_id}/invite`,
      headers: { cookie: A.cookie },
      payload: { email: 'b@example.com' },
    });
    const url = new URL(mailer.last()!.link);
    const accept = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().already_member).toBe(true);
  });
});
