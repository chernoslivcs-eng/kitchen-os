// Черга Г (правка №3): права панель показує ОЧІКУЮТЬ по ВСІХ незакритих
// картках дому, не тільки поточної сесії. GET /v1/cards/pending віддає
// відкриті pending-картки з session_id — клік у панелі веде в ту розмову.

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, createPending } from '@kitchen/domain';
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
    // Пул-8 №2: intake_diff застосовується одразу — в «ОЧІКУЮТЬ» не потрапляє.
    await chatIntake(me.cookie, a.id, 'купив молоко');
    await chatIntake(me.cookie, b.id, 'купив хліб');

    // чужий дім — своя картка, нам не світиться
    const other = await signIn(app, mailer, 'cp2@example.com');
    const c = await repo.createFreshSession(other.user_id, '2026-08-31');
    await chatIntake(other.cookie, c.id, 'купив сир');

    const empty = await app.inject({
      method: 'GET', url: '/v1/cards/pending',
      headers: { cookie: me.cookie },
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().cards).toHaveLength(0);

    // Типи з підтвердженням (shopping) — досі чекають у панелі.
    const shopId = randomUUID();
    await createPending(repo, {
      message_id: shopId, household_id: me.household_id, user_id: me.user_id,
      card: { type: 'shopping', items: [{ op: 'add', label: 'олія' }] },
    });
    await repo.saveMessage({
      id: shopId, session_id: b.id, role: 'assistant',
      text: 'Додати в список?', card: { type: 'shopping', items: [{ op: 'add', label: 'олія' }] },
      applied: 0, created_at: new Date().toISOString(),
    });
    const res = await app.inject({
      method: 'GET', url: '/v1/cards/pending',
      headers: { cookie: me.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { cards } = res.json() as { cards: { id: string; type: string; session_id: string | null }[] };
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: shopId, type: 'shopping', session_id: b.id });
  });
});
