// Живий репро (01.09): модель повернула {"type":"shopping","ops":[...]}
// замість items (плутанина з intake_diff/profile, де саме ops) — картка
// збереглась малформленою, і НАСТУПНИЙ /v1/chat впав 500 «Cannot read
// properties of undefined (reading 'map')» у summarizeCard при читанні
// історії. Тест відтворює це напряму (без живої моделі) — вставляє
// малформлену картку в сесію й перевіряє, що чат не падає.

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';

describe('чат переживає малформлену картку в історії', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let me: Signed;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    me = await signIn(app, mailer, 'me@example.com');
  });

  it('shopping-картка з ops замість items у минулому ході — наступний чат не 500', async () => {
    const session = await repo.getOrCreateSessionForDay(me.user_id, new Date().toISOString().slice(0, 10));
    // Точна форма з живого репро: модель переплутала items↔ops.
    const malformed = { type: 'shopping', ops: [{ op: 'remove', label: 'Напій Schweppes Pink Tonic' }] } as never;
    await repo.saveMessage({
      id: randomUUID(), session_id: session.id, role: 'assistant',
      text: 'Прибрав.', card: malformed, applied: 0, created_at: new Date().toISOString(),
    });

    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'ще щось скажи' },
    });
    expect(r.statusCode).toBe(200);
  });

  it('intake_diff-картка з items замість ops у минулому ході — теж не 500', async () => {
    const session = await repo.getOrCreateSessionForDay(me.user_id, new Date().toISOString().slice(0, 10));
    const malformed = { type: 'intake_diff', items: [{ op: 'add', label: 'молоко' }] } as never;
    await repo.saveMessage({
      id: randomUUID(), session_id: session.id, role: 'assistant',
      text: 'Записав.', card: malformed, applied: 0, created_at: new Date().toISOString(),
    });

    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'ще щось скажи' },
    });
    expect(r.statusCode).toBe(200);
  });
});
