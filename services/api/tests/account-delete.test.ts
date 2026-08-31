// Пул-5 №1: DELETE /v1/me — повне видалення акаунта з опитувальником.
// Живий прецедент: обмін драфт-акаунта на проді ми робили руками SQL-ом;
// тепер це штатна кнопка. Власник забирає з собою дім (де він єдиний член),
// гість зникає з чужого дому, не зачіпаючи його. Причина виходу переживає
// юзера в окремій таблиці.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

describe('DELETE /v1/me', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('власник: юзер і його дім зникають, сесія мертва, опитування записане', async () => {
    const A = await signIn(app, mailer, 'owner@example.com');
    const del = await app.inject({
      method: 'DELETE', url: '/v1/me',
      headers: { cookie: A.cookie },
      payload: { reason: 'unused', comment: 'не прижилось' },
    });
    expect(del.statusCode).toBe(204);

    // Сесія мертва, юзер зник.
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: A.cookie } });
    expect(me.statusCode).toBe(401);
    expect(await repo.findUserByEmail('owner@example.com')).toBeNull();

    // Опитування пережило юзера.
    const surveys = await repo.listExitSurveys();
    expect(surveys).toHaveLength(1);
    expect(surveys[0]).toMatchObject({ email: 'owner@example.com', reason: 'unused', comment: 'не прижилось' });

    // Повторний вхід тим самим мейлом — свіжий акаунт (новий id).
    const again = await signIn(app, mailer, 'owner@example.com');
    expect(again.user_id).not.toBe(A.user_id);
  });

  it('гість: видаляється сам, спільний дім і комора власника неторкані', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    mailer.sent.length = 0;
    await app.inject({
      method: 'POST', url: `/v1/households/${A.household_id}/invite`,
      headers: { cookie: A.cookie }, payload: { email: 'guest@example.com' },
    });
    const tok = new URL(mailer.last()!.link).searchParams.get('token')!;
    const accept = await app.inject({ method: 'GET', url: `/v1/invites/accept?token=${encodeURIComponent(tok)}` });
    const sc = accept.headers['set-cookie']!;
    const gCookie = (Array.isArray(sc) ? sc[0]! : sc).split(';')[0]!;
    const guestId = accept.json().user_id as string;

    const del = await app.inject({
      method: 'DELETE', url: '/v1/me',
      headers: { cookie: gCookie },
      payload: { reason: 'other' },
    });
    expect(del.statusCode).toBe(204);

    // Дім A живий, A досі в ньому, гостя нема.
    expect(await repo.getHousehold(A.household_id)).not.toBeNull();
    expect(await repo.isMember(A.household_id, A.user_id)).toBe(true);
    expect(await repo.isMember(A.household_id, guestId)).toBe(false);
    const meA = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: A.cookie } });
    expect(meA.statusCode).toBe(200);
  });

  it('без причини — теж працює (опитування опційне по суті)', async () => {
    const A = await signIn(app, mailer, 'x@example.com');
    const del = await app.inject({
      method: 'DELETE', url: '/v1/me',
      headers: { cookie: A.cookie },
      payload: {},
    });
    expect(del.statusCode).toBe(204);
    const surveys = await repo.listExitSurveys();
    expect(surveys[0]!.reason).toBe('unspecified');
  });

  it('без сесії — 401', async () => {
    const del = await app.inject({ method: 'DELETE', url: '/v1/me', payload: {} });
    expect(del.statusCode).toBe(401);
  });
});
