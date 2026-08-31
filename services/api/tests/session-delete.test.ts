// Пул-4 №1: видалення сесії. Повідомлення й незакриті картки зникають
// (ОЧІКУЮТЬ чистіє), журнал цілий (cook_run.session_id → null), близнюк
// рецепта більше не знаходиться — наступний клік дає нову сесію.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

describe('DELETE /v1/sessions/:id', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('зносить сесію з повідомленнями і pending; журнал відвʼязується', async () => {
    const me = await signIn(app, mailer, 'sd1@example.com');
    const s = await repo.createFreshSession(me.user_id, '2026-08-31');
    // повідомлення з карткою (pending)
    const chat = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { session_id: s.id, text: 'купив сир' },
    });
    const cardId = chat.json().card_id as string;
    expect(cardId).toBeTruthy();
    // готування, привʼязане до сесії
    const cook = await app.inject({
      method: 'POST', url: '/v1/cook-runs', headers: { cookie: me.cookie },
      payload: { recipe: { t: 'Тест', sv: 1, ing: [], st: [{ t: 'к', c: 'к' }] }, session_id: s.id },
    });
    const runId = cook.json().id as string;

    const del = await app.inject({
      method: 'DELETE', url: `/v1/sessions/${s.id}`, headers: { cookie: me.cookie },
    });
    expect(del.statusCode).toBe(200);

    expect(await repo.getSession(s.id)).toBeNull();
    expect(await repo.listMessages(s.id)).toHaveLength(0);
    const open = await repo.listOpenPending(me.household_id);
    expect(open.find((p) => p.id === cardId)).toBeUndefined();
    const run = await repo.getCookRun(runId);
    expect(run).not.toBeNull();
    expect(run!.session_id ?? null).toBeNull();
  });

  it('чужу сесію видалити не можна', async () => {
    const me = await signIn(app, mailer, 'sd2@example.com');
    const other = await signIn(app, mailer, 'sd3@example.com');
    const s = await repo.createFreshSession(other.user_id, '2026-08-31');
    const del = await app.inject({
      method: 'DELETE', url: `/v1/sessions/${s.id}`, headers: { cookie: me.cookie },
    });
    expect([403, 404]).toContain(del.statusCode);
    expect(await repo.getSession(s.id)).not.toBeNull();
  });

  it('після видалення сесії-близнюка клік по рецепту створює нову', async () => {
    const me = await signIn(app, mailer, 'sd4@example.com');
    // рецепт → сесія-близнюк
    const saved = await app.inject({
      method: 'POST', url: '/v1/recipes', headers: { cookie: me.cookie },
      payload: { recipe: { t: 'Близнюк', sv: 1, ing: [{ n: 'x' }], st: [{ t: 'к', c: 'к' }] } },
    });
    const rid = saved.json().id as string;
    const s1 = await app.inject({
      method: 'POST', url: '/v1/session', headers: { cookie: me.cookie },
      payload: { recipe_id: rid },
    });
    const sid1 = s1.json().session.id as string;
    // близнюк реюзається
    const s2 = await app.inject({
      method: 'POST', url: '/v1/session', headers: { cookie: me.cookie },
      payload: { recipe_id: rid },
    });
    expect(s2.json().session.id).toBe(sid1);
    // видалили → наступний клік дає НОВУ сесію
    await app.inject({ method: 'DELETE', url: `/v1/sessions/${sid1}`, headers: { cookie: me.cookie } });
    const s3 = await app.inject({
      method: 'POST', url: '/v1/session', headers: { cookie: me.cookie },
      payload: { recipe_id: rid },
    });
    expect(s3.statusCode).toBe(200);
    expect(s3.json().session.id).not.toBe(sid1);
  });
});
