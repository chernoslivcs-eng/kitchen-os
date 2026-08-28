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

  it('A запрошує B → B клікає лінк → B у household_member дому A', async () => {
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
    expect(invBody.role).toBe('member');

    const link = mailer.last()!.link;
    expect(link).toContain('/v1/invites/accept?token=');
    const url = new URL(link);

    const accept = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
    expect(accept.statusCode).toBe(200);
    const body = accept.json();
    expect(body.household_id).toBe(A.household_id);
    expect(body.role).toBe('member');
    expect(body.already_member).toBe(false);

    // B справді в домі A
    expect(await repo.isMember(A.household_id, body.user_id)).toBe(true);

    // B тепер може писати в комору A через свою cookie
    const setCookie = accept.headers['set-cookie']!;
    const bCookieRaw = Array.isArray(setCookie) ? setCookie[0]! : setCookie;
    const bCookie = bCookieRaw.split(';')[0]!;

    // Cookie B веде до його «власного» дому (той, що створився з юзером за замовчуванням),
    // а не до дому A — щоб потрапити в дім A, потрібне явне перемикання (окремий крок).
    // Але isMember(A.household_id, B) вже true — це основне.
    expect(bCookie).toBeTruthy();
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
