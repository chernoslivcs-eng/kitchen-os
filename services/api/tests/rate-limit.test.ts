import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

// Ліміти в тестах — низькі й короткочасні, щоб не чекати 15 хв.
// Дефолтні значення (5/15хв, 20/год) обрані для реального продакшена і тут не тестуються.

describe('rate limit', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer, {
      rateLimits: {
        authRequest: { max: 3, windowMs: 60_000 },   // 3 на 60 сек за IP+email
        invite:      { max: 2, windowMs: 60_000 },   // 2 на 60 сек за user_id
        chat:        { max: 2, windowMs: 60_000 },   // 2 на 60 сек за user_id
      },
    });
    await app.ready();
  });

  it('/v1/auth/request: 3 підряд ОК, 4-й — 429', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/v1/auth/request',
        payload: { email: 'me@example.com' },
      });
      expect(r.statusCode).toBe(202);
    }
    const r = await app.inject({
      method: 'POST',
      url: '/v1/auth/request',
      payload: { email: 'me@example.com' },
    });
    expect(r.statusCode).toBe(429);
  });

  it('/v1/auth/request: інший email — інший ключ ліміту, окремий бюджет', async () => {
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'POST', url: '/v1/auth/request', payload: { email: 'a@example.com' } });
    }
    const other = await app.inject({
      method: 'POST',
      url: '/v1/auth/request',
      payload: { email: 'b@example.com' },
    });
    expect(other.statusCode).toBe(202);
  });

  it('/v1/households/:id/invite: 2 підряд ОК, 3-й — 429', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    for (let i = 0; i < 2; i++) {
      const r = await app.inject({
        method: 'POST',
        url: `/v1/households/${A.household_id}/invite`,
        headers: { cookie: A.cookie },
        payload: { email: `guest${i}@example.com` },
      });
      expect(r.statusCode).toBe(201);
    }
    const r = await app.inject({
      method: 'POST',
      url: `/v1/households/${A.household_id}/invite`,
      headers: { cookie: A.cookie },
      payload: { email: 'guest3@example.com' },
    });
    expect(r.statusCode).toBe(429);
  });

  it('/v1/chat: 2 підряд ОК, 3-й — 429; ліміт per-user, не per-IP', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const B = await signIn(app, mailer, 'b@example.com');
    for (let i = 0; i < 2; i++) {
      const r = await app.inject({
        method: 'POST', url: '/v1/chat',
        headers: { cookie: A.cookie },
        payload: { text: 'привіт' },
      });
      expect(r.statusCode).toBe(200);
    }
    const over = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: A.cookie },
      payload: { text: 'привіт' },
    });
    expect(over.statusCode).toBe(429);

    // Інший юзер — свій бюджет, ліміт не з'їдений
    const otherUser = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: B.cookie },
      payload: { text: 'привіт' },
    });
    expect(otherUser.statusCode).toBe(200);
  });

  it('невалідний email рахується як спроба (щоб scanner не обходив ліміт)', async () => {
    // Битий email → 400, але й слот ліміту витрачений. Чому: якщо не витрачати,
    // то атакуючий підбирає валідні адреси перебором, не отримуючи 429.
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'POST', url: '/v1/auth/request', payload: { email: 'not-an-email' } });
    }
    const r = await app.inject({
      method: 'POST',
      url: '/v1/auth/request',
      payload: { email: 'not-an-email' },
    });
    expect(r.statusCode).toBe(429);
  });
});

// П.6 pre-deploy: shopping і attachments були без лімітів.
describe('rate limit: shopping і attachments', () => {
  it('POST /v1/shopping ріжеться після стелі', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const app = buildApp(repo, new InMemoryStore(), mailer, { rateLimits: { shopping: { max: 3, windowMs: 60_000 } } });
    await app.ready();
    const me = await signIn(app, mailer, 'rl-shop@example.com');
    let last = 0;
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({
        method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie },
        payload: { label: `позиція ${i}` },
      });
      last = r.statusCode;
    }
    expect(last).toBe(429);
  });
});

// Розмір рецепта обмежений: 64KB JSON — щедро для будь-якої страви, але
// зупиняє «рецепт»-сміттєвоз у БД (payload їде в кожне recipe_link-повідомлення).
describe('recipe payload cap', () => {
  it('POST /v1/recipes із роздутим payload → 413', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    const me = await signIn(app, mailer, 'cap@example.com');
    const fat = { t: 'Жирний', sv: 2, tm: 5, ch: '', d: 'x'.repeat(80_000), rk: '', ing: [], st: [] };
    const r = await app.inject({
      method: 'POST', url: '/v1/recipes', headers: { cookie: me.cookie },
      payload: { recipe: fat },
    });
    expect(r.statusCode).toBe(413);
  });
});

// Security-заголовки на кожній відповіді API.
describe('security headers', () => {
  it('nosniff / frame-deny / referrer-policy присутні', async () => {
    const repo = new InMemoryRepo();
    const app = buildApp(repo, new InMemoryStore(), new ConsoleMailer());
    await app.ready();
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});
