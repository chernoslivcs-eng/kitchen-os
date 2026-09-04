// Аудит раунд 3, крок 1: POST /v1/cards/:id/dismiss — «Ні» на pending-картці,
// тепер у БД, не лише в React-стані вкладки (Feed.tsx dismissCard).

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, createPending, applyCard } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

describe('POST /v1/cards/:id/dismiss', () => {
  let repo: InMemoryRepo;
  let app: ReturnType<typeof buildApp>;
  let mailer: ConsoleMailer;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('200: відхиляє pending-картку і прибирає її з /v1/cards/pending', async () => {
    const me = await signIn(app, mailer, 'cd1@example.com');
    const cardId = randomUUID();
    await createPending(repo, {
      message_id: cardId, household_id: me.household_id, user_id: me.user_id,
      card: { type: 'shopping', items: [{ op: 'add', label: 'олія' }] },
    });
    await repo.saveMessage({
      id: cardId, session_id: (await repo.createFreshSession(me.user_id, '2026-09-05')).id,
      role: 'assistant', text: 'Додати в список?',
      card: { type: 'shopping', items: [{ op: 'add', label: 'олія' }] },
      applied: 0, created_at: new Date().toISOString(),
    });

    const before = await app.inject({ method: 'GET', url: '/v1/cards/pending', headers: { cookie: me.cookie } });
    expect(before.json().cards).toHaveLength(1);

    const res = await app.inject({
      method: 'POST', url: `/v1/cards/${cardId}/dismiss`,
      headers: { cookie: me.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ dismissed: true, already: false });

    const after = await app.inject({ method: 'GET', url: '/v1/cards/pending', headers: { cookie: me.cookie } });
    expect(after.json().cards).toHaveLength(0);

    // Повторний dismiss — ідемпотентно, той самий 200.
    const again = await app.inject({
      method: 'POST', url: `/v1/cards/${cardId}/dismiss`,
      headers: { cookie: me.cookie },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ dismissed: true, already: true });
  });

  it('409: застосовану картку не відхилити — шлях назад undo', async () => {
    const me = await signIn(app, mailer, 'cd2@example.com');
    const cardId = randomUUID();
    await createPending(repo, {
      message_id: cardId, household_id: me.household_id, user_id: me.user_id,
      card: { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко' }] },
    });
    await applyCard(repo, cardId, [], me.user_id);

    const res = await app.inject({
      method: 'POST', url: `/v1/cards/${cardId}/dismiss`,
      headers: { cookie: me.cookie },
    });
    expect(res.statusCode).toBe(409);
  });

  it('404: картки не існує', async () => {
    const me = await signIn(app, mailer, 'cd3@example.com');
    const res = await app.inject({
      method: 'POST', url: `/v1/cards/${randomUUID()}/dismiss`,
      headers: { cookie: me.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('403: чужу картку не відхилити (той самий auth-контракт, що undo)', async () => {
    const owner = await signIn(app, mailer, 'cd4a@example.com');
    const stranger = await signIn(app, mailer, 'cd4b@example.com');
    const cardId = randomUUID();
    await createPending(repo, {
      message_id: cardId, household_id: owner.household_id, user_id: owner.user_id,
      card: { type: 'shopping', items: [{ op: 'add', label: 'олія' }] },
    });

    const res = await app.inject({
      method: 'POST', url: `/v1/cards/${cardId}/dismiss`,
      headers: { cookie: stranger.cookie },
    });
    expect(res.statusCode).toBe(403);
  });
});
