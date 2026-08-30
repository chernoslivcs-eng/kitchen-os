// Черга Г (правка №3): права панель показує ОЧІКУЮТЬ по ВСІХ незакритих
// картках дому, не тільки поточної сесії. GET /v1/cards/pending віддає
// відкриті pending-картки з session_id — клік у панелі веде в ту розмову.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

describe('GET /v1/cards/pending', () => {
  let repo: InMemoryRepo;
  let app: ReturnType<typeof buildApp>;
  let mailer: ConsoleMailer;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  async function chatIntake(cookie: string, session_id: string, text: string) {
    const r = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie },
      payload: { session_id, text },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.card_id).toBeTruthy();
    return body.card_id as string;
  }

  it('віддає відкриті картки дому з session_id; applied не показує; чуже не видно', async () => {
    const me = await signIn(app, mailer, 'cp1@example.com');
    const a = await repo.createFreshSession(me.user_id, '2026-08-31');
    const b = await repo.createFreshSession(me.user_id, '2026-08-31');
    const cardA = await chatIntake(me.cookie, a.id, 'купив молоко');
    const cardB = await chatIntake(me.cookie, b.id, 'купив хліб');

    // чужий дім — своя картка, нам не світиться
    const other = await signIn(app, mailer, 'cp2@example.com');
    const c = await repo.createFreshSession(other.user_id, '2026-08-31');
    await chatIntake(other.cookie, c.id, 'купив сир');

    // застосовуємо одну зі своїх
    const apply = await app.inject({
      method: 'POST', url: `/v1/cards/${cardA}/apply`,
      headers: { cookie: me.cookie }, payload: {},
    });
    expect(apply.statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET', url: '/v1/cards/pending',
      headers: { cookie: me.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { cards } = res.json() as { cards: { id: string; type: string; session_id: string | null }[] };
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: cardB, type: 'intake_diff', session_id: b.id });
  });
});
