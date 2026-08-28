import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

// Повний потік: request → лист із лінком → verify → cookie → захищений виклик → logout → 401.
// Тести навмисно не мокають криптографію: ті самі SHA-256 і base64url, що на проді.

describe('magic-link auth', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('request → verify → авторизований /v1/chat → logout → 401', async () => {
    // request
    const req = await app.inject({ method: 'POST', url: '/v1/auth/request', payload: { email: 'me@example.com' } });
    expect(req.statusCode).toBe(202);
    const link = mailer.last()!.link;
    expect(link).toContain('/v1/auth/verify?token=');

    // verify
    const url = new URL(link);
    const verify = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
    expect(verify.statusCode).toBe(200);
    const body = verify.json();
    expect(body.user_id).toBeTruthy();
    expect(body.household_id).toBeTruthy();
    const setCookie = verify.headers['set-cookie']!;
    const cookieRaw = Array.isArray(setCookie) ? setCookie[0]! : setCookie;
    expect(cookieRaw).toContain('HttpOnly');
    expect(cookieRaw).toContain('SameSite=Lax');
    expect(cookieRaw).toContain('Path=/');
    const cookie = cookieRaw.split(';')[0]!;

    // Захищений виклик — тепер працює.
    const chat = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie },
      payload: { session_id: 's', text: 'привіт' },
    });
    expect(chat.statusCode).toBe(200);

    // logout
    const logout = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { cookie } });
    expect(logout.statusCode).toBe(204);

    // Той самий cookie далі не працює.
    const chat2 = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie },
      payload: { session_id: 's', text: 'привіт' },
    });
    expect(chat2.statusCode).toBe(401);
  });

  it('одноразовість: verify з тим самим токеном другий раз — 410', async () => {
    await app.inject({ method: 'POST', url: '/v1/auth/request', payload: { email: 'me@example.com' } });
    const url = new URL(mailer.last()!.link);
    const first = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
    expect(second.statusCode).toBe(410);
    expect(second.json().error).toBe('consumed');
  });

  it('verify з невідомим токеном — 404', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/auth/verify?token=nonsense' });
    expect(r.statusCode).toBe(404);
  });

  it('request з битим email — 400; коректний email завжди дає 202 (не ліком інформацію про існування)', async () => {
    const bad = await app.inject({ method: 'POST', url: '/v1/auth/request', payload: { email: 'not-an-email' } });
    expect(bad.statusCode).toBe(400);

    // Юзера ще не існує — все одно 202.
    const ok = await app.inject({ method: 'POST', url: '/v1/auth/request', payload: { email: 'ghost@example.com' } });
    expect(ok.statusCode).toBe(202);
  });

  it('другий вхід тим самим email — це той самий user, той самий household, але нова сесія', async () => {
    const s1 = await signIn(app, mailer, 'me@example.com');
    const s2 = await signIn(app, mailer, 'me@example.com');
    expect(s2.user_id).toBe(s1.user_id);
    expect(s2.household_id).toBe(s1.household_id);
    expect(s2.cookie).not.toBe(s1.cookie);
  });
});
