import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, createPending, applyCard } from '@kitchen/domain';
import { randomUUID } from 'node:crypto';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

describe('GET /v1/me + /v1/pantry', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('/v1/me: без cookie — 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(r.statusCode).toBe(401);
  });

  it('/v1/me: одинак — user, дім, один owner-member', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const r = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: A.cookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.user.email).toBe('a@example.com');
    expect(body.household.id).toBe(A.household_id);
    expect(body.household.role).toBe('owner');
    expect(body.household.members).toHaveLength(1);
    expect(body.household.members[0].user_id).toBe(A.user_id);
    expect(body.household.members[0].role).toBe('owner');
  });

  it('/v1/me після invite: у обох /me показує двох членів дому', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    mailer.sent.length = 0;
    await app.inject({
      method: 'POST', url: `/v1/households/${A.household_id}/invite`,
      headers: { cookie: A.cookie },
      payload: { email: 'b@example.com' },
    });
    const tok = new URL(mailer.last()!.link).searchParams.get('token')!;
    const accept = await app.inject({ method: 'GET', url: `/v1/invites/accept?token=${encodeURIComponent(tok)}` });
    const setCookie = accept.headers['set-cookie']!;
    const bCookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(';')[0]!;

    for (const c of [A.cookie, bCookie]) {
      const r = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: c } });
      const body = r.json();
      expect(body.household.id).toBe(A.household_id);
      expect(body.household.members).toHaveLength(2);
      const roles = body.household.members.map((m: { role: string }) => m.role).sort();
      expect(roles).toEqual(['member', 'owner']);
    }
  });

  it('/v1/pantry: без cookie — 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/pantry' });
    expect(r.statusCode).toBe(401);
  });

  it('/v1/pantry: порожня комора → count 0', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const r = await app.inject({ method: 'GET', url: '/v1/pantry', headers: { cookie: A.cookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.household_id).toBe(A.household_id);
    expect(body.count).toBe(0);
    expect(body.batches).toEqual([]);
  });

  it('/v1/pantry: після /chat + /apply зʼявляється партія; сортування терміновості', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    // Стаб «купив X» додає партію.
    const chat = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: A.cookie },
      payload: { session_id: 's', text: 'купив моцарелу 250 г' },
    });
    await app.inject({
      method: 'POST', url: `/v1/cards/${chat.json().card_id}/apply`,
      headers: { cookie: A.cookie }, payload: {},
    });
    const r = await app.inject({ method: 'GET', url: '/v1/pantry', headers: { cookie: A.cookie } });
    const body = r.json();
    expect(body.count).toBe(1);
    expect(body.batches[0].label.toLowerCase()).toContain('моцарел');
    expect(body.batches[0].state).toBe('sealed');
  });

  it('/v1/pantry гостя показує ту саму комору, що й у власника', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    // A кладе продукт
    const chat = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: A.cookie },
      payload: { session_id: 's', text: 'купив пелаті' },
    });
    await app.inject({
      method: 'POST', url: `/v1/cards/${chat.json().card_id}/apply`,
      headers: { cookie: A.cookie }, payload: {},
    });
    // Запрошуємо B
    mailer.sent.length = 0;
    await app.inject({
      method: 'POST', url: `/v1/households/${A.household_id}/invite`,
      headers: { cookie: A.cookie }, payload: { email: 'b@example.com' },
    });
    const tok = new URL(mailer.last()!.link).searchParams.get('token')!;
    const accept = await app.inject({ method: 'GET', url: `/v1/invites/accept?token=${encodeURIComponent(tok)}` });
    const setCookie = accept.headers['set-cookie']!;
    const bCookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(';')[0]!;

    const r = await app.inject({ method: 'GET', url: '/v1/pantry', headers: { cookie: bCookie } });
    const body = r.json();
    expect(body.household_id).toBe(A.household_id);
    expect(body.count).toBe(1);
    expect(body.batches[0].label.toLowerCase()).toContain('пелаті');
  });

  it('PATCH /v1/pantry/:id: юзер редагує кількість і зону', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const chat = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: A.cookie },
      payload: { session_id: 's', text: 'купив моцарелу 250 г' },
    });
    await app.inject({
      method: 'POST', url: `/v1/cards/${chat.json().card_id}/apply`,
      headers: { cookie: A.cookie }, payload: {},
    });
    const list = await app.inject({ method: 'GET', url: '/v1/pantry', headers: { cookie: A.cookie } });
    const batchId = list.json().batches[0].id;

    const patch = await app.inject({
      method: 'PATCH', url: `/v1/pantry/${batchId}`,
      headers: { cookie: A.cookie },
      payload: { value: 500, unit: 'g', zone: 'freezer', state: 'opened' },
    });
    expect(patch.statusCode).toBe(200);
    const body = patch.json();
    expect(body.batch.value).toBe(500);
    expect(body.batch.zone).toBe('freezer');
    expect(body.batch.state).toBe('opened');
    expect(body.batch.opened_at).toBeTruthy();
    expect(body.batch.last_action).toBe('user_edit');
  });

  it('PATCH /v1/pantry/:id: чужа партія — 403', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const B = await signIn(app, mailer, 'b@example.com');
    const chat = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: A.cookie },
      payload: { session_id: 's', text: 'купив моцарелу' },
    });
    await app.inject({
      method: 'POST', url: `/v1/cards/${chat.json().card_id}/apply`,
      headers: { cookie: A.cookie }, payload: {},
    });
    const list = await app.inject({ method: 'GET', url: '/v1/pantry', headers: { cookie: A.cookie } });
    const batchId = list.json().batches[0].id;

    const patch = await app.inject({
      method: 'PATCH', url: `/v1/pantry/${batchId}`,
      headers: { cookie: B.cookie }, payload: { label: 'моя моцарела' },
    });
    expect(patch.statusCode).toBe(403);
  });

  it('POST /v1/pantry: пряме додавання партії обходить чат', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const r = await app.inject({
      method: 'POST', url: '/v1/pantry',
      headers: { cookie: A.cookie },
      payload: { label: 'моцарела', value: 250, unit: 'g', zone: 'fridge' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.batch.label).toBe('моцарела');
    expect(body.batch.value).toBe(250);
    expect(body.batch.zone).toBe('fridge');
    expect(body.batch.state).toBe('sealed');
    expect(body.batch.last_action).toBe('user_add');
  });

  it('POST /v1/pantry: без label — 400', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const r = await app.inject({
      method: 'POST', url: '/v1/pantry',
      headers: { cookie: A.cookie },
      payload: { label: '   ' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('DELETE /v1/pantry/:id: м\'яке видалення переводить у depleted', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const chat = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: A.cookie },
      payload: { session_id: 's', text: 'купив пелаті' },
    });
    await app.inject({
      method: 'POST', url: `/v1/cards/${chat.json().card_id}/apply`,
      headers: { cookie: A.cookie }, payload: {},
    });
    const list = await app.inject({ method: 'GET', url: '/v1/pantry', headers: { cookie: A.cookie } });
    const batchId = list.json().batches[0].id;

    const del = await app.inject({
      method: 'DELETE', url: `/v1/pantry/${batchId}`,
      headers: { cookie: A.cookie },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().deleted).toBe(true);

    // Тепер /v1/pantry не показує її
    const list2 = await app.inject({ method: 'GET', url: '/v1/pantry', headers: { cookie: A.cookie } });
    expect(list2.json().count).toBe(0);
    // Але вона є в repo із state=depleted
    const raw = await repo.getBatch(batchId);
    expect(raw?.state).toBe('depleted');
  });
});

// Пул-3, пошук у коморі: «сир» має знаходити моцарелу/камбоцолу/пармезан.
// Сервер віддає до продукту search_terms з каталогу (категорії + аліаси) —
// клієнт шукає по них, не тільки по назві.
describe('GET /v1/pantry: search_terms з каталогу', () => {
  it('продукт із catalog_key несе категорії й аліаси', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    const me = await signIn(app, mailer, 'st1@example.com');
    const mid = randomUUID();
    await createPending(repo, { message_id: mid, household_id: me.household_id, user_id: me.user_id, card: {
      type: 'intake_diff', ops: [{ op: 'add', label: 'камбоцола', value: 200, unit: 'g', zone: 'fridge', product: 'камбоцола' }],
    } });
    await applyCard(repo, mid, [], me.user_id);

    const res = await app.inject({ method: 'GET', url: '/v1/pantry', headers: { cookie: me.cookie } });
    const { products } = res.json() as { products: { product: string; search_terms?: string[] }[] };
    const camb = products.find((p) => p.product === 'камбоцола')!;
    expect(camb.search_terms).toContain('сир');
    expect(camb.search_terms).toContain('молочне');
  });
});
