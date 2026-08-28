import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

// Інтеграція: /v1/chat повертає картку (не застосовану), /apply мутує стан,
// /undo повертає назад. user_id/household_id — з cookie, не з тіла.
// Без ANTHROPIC_API_KEY модель у режимі стаба: «купив X» → intake_diff add(X).

describe('POST /v1/chat → /apply → /undo (authenticated)', () => {
  let repo: InMemoryRepo;
  let store: InMemoryStore;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    store = new InMemoryStore();
    mailer = new ConsoleMailer();
    app = buildApp(repo, store, mailer);
    await app.ready();
  });

  it('картка → apply → undo, з ідемпотентним повторним apply', async () => {
    const me = await signIn(app, mailer, 'me@example.com');

    const chat = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { cookie: me.cookie },
      payload: { session_id: 's', text: 'купив моцарелу 250 г' },
    });
    expect(chat.statusCode).toBe(200);
    const body = chat.json();
    expect(body.card?.type).toBe('intake_diff');
    expect(body.card_id).toBeTruthy();
    expect(await repo.listBatches(me.household_id)).toHaveLength(0);

    const apply = await app.inject({
      method: 'POST',
      url: `/v1/cards/${body.card_id}/apply`,
      headers: { cookie: me.cookie },
      payload: { selected: [] },
    });
    expect(apply.statusCode).toBe(200);
    const applyBody = apply.json();
    expect(applyBody.applied).toBe(1);
    expect(applyBody.undo_token).toBeTruthy();

    const batches = await repo.listBatches(me.household_id);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.label.toLowerCase()).toContain('моцарел');

    const apply2 = await app.inject({
      method: 'POST',
      url: `/v1/cards/${body.card_id}/apply`,
      headers: { cookie: me.cookie },
      payload: {},
    });
    expect(apply2.json().already).toBe(true);
    expect(apply2.json().undo_token).toBe(applyBody.undo_token);
    expect(await repo.listBatches(me.household_id)).toHaveLength(1);

    const undo = await app.inject({
      method: 'POST',
      url: `/v1/cards/${body.card_id}/undo`,
      headers: { cookie: me.cookie },
      payload: { undo_token: applyBody.undo_token },
    });
    expect(undo.statusCode).toBe(200);
    expect(undo.json().undone).toBe(true);
    expect(await repo.listBatches(me.household_id)).toHaveLength(0);
  });

  it('стаб не породжує картку на нейтральний текст', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const chat = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { cookie: me.cookie },
      payload: { session_id: 's', text: 'привіт' },
    });
    const body = chat.json();
    expect(body.card).toBeNull();
    expect(body.card_id).toBeNull();
  });

  it('чужа сесія на apply — 403 (та сама картка, інший актор)', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const other = await signIn(app, mailer, 'other@example.com');
    const chat = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { cookie: me.cookie },
      payload: { session_id: 's', text: 'купив пармезан' },
    });
    const { card_id } = chat.json();
    const apply = await app.inject({
      method: 'POST',
      url: `/v1/cards/${card_id}/apply`,
      headers: { cookie: other.cookie },
      payload: {},
    });
    expect(apply.statusCode).toBe(403);
  });

  it('без cookie — 401 на всіх захищених ендпоінтах', async () => {
    const r1 = await app.inject({ method: 'POST', url: '/v1/chat', payload: { text: 'привіт' } });
    expect(r1.statusCode).toBe(401);
    const r2 = await app.inject({ method: 'POST', url: '/v1/cards/00000000-0000-0000-0000-000000000000/apply', payload: {} });
    expect(r2.statusCode).toBe(401);
    const r3 = await app.inject({
      method: 'POST',
      url: '/v1/cards/00000000-0000-0000-0000-000000000000/undo',
      payload: { undo_token: 'x' },
    });
    expect(r3.statusCode).toBe(401);
  });

  it('apply з неіснуючим card_id (в сесії) — 404', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const apply = await app.inject({
      method: 'POST',
      url: `/v1/cards/00000000-0000-0000-0000-000000000000/apply`,
      headers: { cookie: me.cookie },
      payload: {},
    });
    expect(apply.statusCode).toBe(404);
  });

  it('/v1/chat без text і без attachments — 400', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const r = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { cookie: me.cookie },
      payload: { session_id: 's' },
    });
    expect(r.statusCode).toBe(400);
  });
});
