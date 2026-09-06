// Крок Е1, серверна половина: 429 називає час, 410 веде браузер на екран.
//
// Обидві речі невидимі в коді клієнта і ламаються тихо: без `Retry-After`
// смужка стікала б за вигаданий час, а без редиректу людина по лінку з листа
// бачила б сирий JSON.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { makeRateLimiter } from '../src/rate-limit.js';
// signIn токена не віддає — беремо його з листа, який ConsoleMailer запамʼятав.
async function magicToken(app: ReturnType<typeof buildApp>, mailer: ConsoleMailer, email: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/v1/auth/request', payload: { email } });
  const last = mailer.last();
  if (!last) throw new Error('лист не надійшов');
  return new URL(last.link).searchParams.get('token')!;
}

describe('rate-limiter: скільки лишилось чекати', () => {
  it('retryAfter рахує залишок вікна, не константу', () => {
    const lim = makeRateLimiter({ max: 1, windowMs: 30_000 });
    // Ключ ще не бачили — чекати нема чого, але й нуля не кажемо.
    expect(lim.retryAfter('u1')).toBe(1);
    lim.check('u1');
    const left = lim.retryAfter('u1');
    expect(left).toBeGreaterThan(28);
    expect(left).toBeLessThanOrEqual(30);
  });

  it('ніколи не віддає нуль — «0 секунд» читається як «уже можна»', () => {
    const lim = makeRateLimiter({ max: 1, windowMs: 1 });
    lim.check('u1');
    expect(lim.retryAfter('u1')).toBeGreaterThanOrEqual(1);
  });
});

describe('410 на магічний лінк', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('браузер отримує екран, а не JSON: expired і consumed — різні адреси', async () => {
    const token = await magicToken(app, mailer, 'e1@example.com');
    await app.inject({ method: 'GET', url: `/v1/auth/verify?token=${encodeURIComponent(token)}` });
    // Той самий токен удруге — consumed.
    const again = await app.inject({
      method: 'GET',
      url: `/v1/auth/verify?token=${encodeURIComponent(token)}`,
      headers: { accept: 'text/html' },
    });
    expect(again.statusCode).toBe(302);
    expect(again.headers.location).toBe('/link/consumed');
  });

  it('клієнтам, що просять JSON, лишається той самий 410', async () => {
    const token = await magicToken(app, mailer, 'e2@example.com');
    await app.inject({ method: 'GET', url: `/v1/auth/verify?token=${encodeURIComponent(token)}` });
    const again = await app.inject({
      method: 'GET',
      url: `/v1/auth/verify?token=${encodeURIComponent(token)}`,
    });
    expect(again.statusCode).toBe(410);
    expect(again.json()).toEqual({ error: 'consumed' });
  });

  it('невідомий токен — 404, а не екран лінка', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/v1/auth/verify?token=нема-такого',
      headers: { accept: 'text/html' },
    });
    expect(r.statusCode).toBe(404);
  });
});
