// Пул-5, черга А: (№3) /health чесно вантажить промпти — інцидент
// versions/versions на проді пройшов повз health, бо той друкував константу.
// (№2) інвайт: браузерний клік веде на фронтову сторінку /invite, НЕ споживає
// токен; інфо-ендпоінт віддає назву дому без побічних ефектів.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

describe('health: промпти вантажаться реально (№3)', () => {
  it('здоровий стан: у відповіді конкретна версія промптів, не заглушка', async () => {
    const app = buildApp(new InMemoryRepo(), new InMemoryStore(), new ConsoleMailer());
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    // Версія — датована тека (2026-…), а не '(latest)'-константа.
    expect(body.prompt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('інвайт: сторінка замість сирого JSON (№2)', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let ownerCookie: string;
  let token: string;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    const owner = await signIn(app, mailer, 'owner@example.com');
    ownerCookie = owner.cookie;
    await app.inject({
      method: 'POST',
      url: `/v1/households/${owner.household_id}/invite`,
      headers: { cookie: ownerCookie },
      payload: { email: 'guest@example.com' },
    });
    const link = mailer.last()!.link;
    token = new URL(link).searchParams.get('token')!;
  });

  it('лист лінкує на фронтову сторінку /invite, не на API-роут', () => {
    const link = mailer.last()!.link;
    expect(link).toContain('/invite?token=');
    expect(link).not.toContain('/v1/invites/accept');
  });

  it('GET /v1/invites/info: назва дому і мейл без споживання токена', async () => {
    const info = await app.inject({ method: 'GET', url: `/v1/invites/info?token=${token}` });
    expect(info.statusCode).toBe(200);
    const body = info.json();
    expect(body.household_name).toBeTruthy();
    expect(body.email).toBe('guest@example.com');

    // Токен живий: інфо можна читати повторно, а accept після інфо працює.
    const again = await app.inject({ method: 'GET', url: `/v1/invites/info?token=${token}` });
    expect(again.statusCode).toBe(200);
    const accept = await app.inject({ method: 'GET', url: `/v1/invites/accept?token=${token}` });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().ok).toBe(true);
  });

  it('інфо про мертвий токен → 404', async () => {
    const info = await app.inject({ method: 'GET', url: '/v1/invites/info?token=nonsense' });
    expect(info.statusCode).toBe(404);
  });

  it('браузерний GET accept (Accept: text/html) → редирект на /invite, токен НЕ спожитий', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/invites/accept?token=${token}`,
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/invite?token=');
    // Після редиректу програмний accept усе ще працює — токен живий.
    const accept = await app.inject({ method: 'GET', url: `/v1/invites/accept?token=${token}` });
    expect(accept.statusCode).toBe(200);
  });
});
