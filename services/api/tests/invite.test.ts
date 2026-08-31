import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

async function acceptInvite(app: ReturnType<typeof buildApp>, mailer: ConsoleMailer): Promise<string> {
  // Пул-5 №2: лист веде на фронтову сторінку /invite — тест дістає токен і
  // приймає програмно, як робить кнопка «Прийняти» на тій сторінці.
  const token = new URL(mailer.last()!.link).searchParams.get('token')!;
  const res = await app.inject({ method: 'GET', url: `/v1/invites/accept?token=${encodeURIComponent(token)}` });
  const setCookie = res.headers['set-cookie']!;
  const cookieRaw = Array.isArray(setCookie) ? setCookie[0]! : setCookie;
  return cookieRaw.split(';')[0]!;
}

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

    const tok = new URL(mailer.last()!.link).searchParams.get('token')!;
    const accept = await app.inject({ method: 'GET', url: `/v1/invites/accept?token=${encodeURIComponent(tok)}` });
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
    const link = `/v1/invites/accept?token=${encodeURIComponent(new URL(mailer.last()!.link).searchParams.get('token')!)}`;

    const rev = await app.inject({
      method: 'POST',
      url: `/v1/invites/${id}/revoke`,
      headers: { cookie: A.cookie },
    });
    expect(rev.statusCode).toBe(204);

    const accept = await app.inject({ method: 'GET', url: link });
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
    const tok = new URL(mailer.last()!.link).searchParams.get('token')!;
    const acceptUrl = `/v1/invites/accept?token=${encodeURIComponent(tok)}`;
    const first = await app.inject({ method: 'GET', url: acceptUrl });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'GET', url: acceptUrl });
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
    const tok = new URL(mailer.last()!.link).searchParams.get('token')!;
    const accept = await app.inject({ method: 'GET', url: `/v1/invites/accept?token=${encodeURIComponent(tok)}` });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().already_member).toBe(true);
  });
});

describe('DELETE /v1/households/:hid/members/:uid', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('власник виключає учасника', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    // Запросимо B і приймемо
    mailer.sent.length = 0;
    await app.inject({
      method: 'POST', url: `/v1/households/${A.household_id}/invite`,
      headers: { cookie: A.cookie }, payload: { email: 'b@example.com' },
    });
    const bCookie = await acceptInvite(app, mailer);
    const bMe = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: bCookie } });
    const bUserId = bMe.json().user.id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/households/${A.household_id}/members/${bUserId}`,
      headers: { cookie: A.cookie },
    });
    expect(del.statusCode).toBe(204);

    const members = await repo.listMembersOfHousehold(A.household_id);
    expect(members.map((m) => m.name)).not.toContain('b');
  });

  it('учасник не може виключити іншого', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    mailer.sent.length = 0;
    await app.inject({
      method: 'POST', url: `/v1/households/${A.household_id}/invite`,
      headers: { cookie: A.cookie }, payload: { email: 'b@example.com' },
    });
    const bCookie = await acceptInvite(app, mailer);

    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/households/${A.household_id}/members/${A.user_id}`,
      headers: { cookie: bCookie },
    });
    expect(del.statusCode).toBe(403);
  });

  it('учасник виходить сам', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    mailer.sent.length = 0;
    await app.inject({
      method: 'POST', url: `/v1/households/${A.household_id}/invite`,
      headers: { cookie: A.cookie }, payload: { email: 'b@example.com' },
    });
    const bCookie = await acceptInvite(app, mailer);
    const bMe = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: bCookie } });
    const bUserId = bMe.json().user.id;

    const leave = await app.inject({
      method: 'DELETE',
      url: `/v1/households/${A.household_id}/members/${bUserId}`,
      headers: { cookie: bCookie },
    });
    expect(leave.statusCode).toBe(204);
  });

  it('власник передає роль → тепер новий власник, старий стає member', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    mailer.sent.length = 0;
    await app.inject({
      method: 'POST', url: `/v1/households/${A.household_id}/invite`,
      headers: { cookie: A.cookie }, payload: { email: 'b@example.com' },
    });
    const bCookie = await acceptInvite(app, mailer);
    const bMe = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: bCookie } });
    const bUserId = bMe.json().user.id;

    // Спочатку А підвищує B
    const up = await app.inject({
      method: 'PATCH', url: `/v1/households/${A.household_id}/members/${bUserId}`,
      headers: { cookie: A.cookie }, payload: { role: 'owner' },
    });
    expect(up.statusCode).toBe(200);

    // Потім А знижує себе
    const down = await app.inject({
      method: 'PATCH', url: `/v1/households/${A.household_id}/members/${A.user_id}`,
      headers: { cookie: A.cookie }, payload: { role: 'member' },
    });
    expect(down.statusCode).toBe(200);

    const members = await repo.listMembersOfHousehold(A.household_id);
    const roles = new Map(members.map((m) => [m.user_id, m.role]));
    expect(roles.get(bUserId)).toBe('owner');
    expect(roles.get(A.user_id)).toBe('member');
  });

  it('останній власник не може знизити собі роль', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const res = await app.inject({
      method: 'PATCH', url: `/v1/households/${A.household_id}/members/${A.user_id}`,
      headers: { cookie: A.cookie }, payload: { role: 'member' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('last_owner_cannot_downgrade');
  });

  it('member не може міняти ролі', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    mailer.sent.length = 0;
    await app.inject({
      method: 'POST', url: `/v1/households/${A.household_id}/invite`,
      headers: { cookie: A.cookie }, payload: { email: 'b@example.com' },
    });
    const bCookie = await acceptInvite(app, mailer);
    const res = await app.inject({
      method: 'PATCH', url: `/v1/households/${A.household_id}/members/${A.user_id}`,
      headers: { cookie: bCookie }, payload: { role: 'member' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('останній власник не може вийти', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/households/${A.household_id}/members/${A.user_id}`,
      headers: { cookie: A.cookie },
    });
    expect(del.statusCode).toBe(409);
    expect(del.json().error).toBe('last_owner_cannot_leave');
  });
});
