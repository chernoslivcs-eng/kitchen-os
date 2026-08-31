// Google OAuth — другий спосіб довести «я власник цього мейла», далі той самий
// флоу користувача, що й у magic-link: find-or-create по email + сесійна кука.
// Обмін коду на профіль ізольований в exchange-фунцію: тести підставляють свою,
// прод ходить у https://oauth2.googleapis.com/token.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import type { GoogleProfile } from '../src/routes/auth-google.js';

const GOOGLE_CFG = { clientId: 'test-client-id', clientSecret: 'test-secret' };

function appWith(exchange: (code: string, redirectUri: string) => Promise<GoogleProfile>) {
  const repo = new InMemoryRepo();
  const app = buildApp(repo, new InMemoryStore(), new ConsoleMailer(), {
    google: { ...GOOGLE_CFG, exchange },
  });
  return { repo, app };
}

function stateCookieOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  const arr = Array.isArray(sc) ? sc : [sc];
  const row = arr.find((c) => String(c).startsWith('kos_oauth_state='));
  return String(row).split(';')[0]!.split('=')[1]!;
}

describe('google oauth', () => {
  let repo: InMemoryRepo;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    ({ repo, app } = appWith(async () => ({
      email: 'g@example.com', email_verified: true, name: 'Ґуґл Юзер',
    })));
    await app.ready();
  });

  it('без конфігурації роути відсутні (404)', async () => {
    const bare = buildApp(new InMemoryRepo(), new InMemoryStore(), new ConsoleMailer());
    await bare.ready();
    const res = await bare.inject({ method: 'GET', url: '/v1/auth/google' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /v1/auth/google → 302 на accounts.google.com зі state-кукою', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/google' });
    expect(res.statusCode).toBe(302);
    const loc = new URL(res.headers.location as string);
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(loc.searchParams.get('client_id')).toBe('test-client-id');
    expect(loc.searchParams.get('response_type')).toBe('code');
    expect(loc.searchParams.get('scope')).toContain('email');
    const state = loc.searchParams.get('state')!;
    expect(state.length).toBeGreaterThan(20);
    expect(stateCookieOf(res)).toBe(state);
  });

  it('callback без збігу state → 400, сесія не створюється', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/google/callback?code=abc&state=evil',
      cookies: { kos_oauth_state: 'good' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['set-cookie'] ?? '').not.toContain('kos=');
  });

  it('щасливий шлях: callback створює юзера з домом і ставить kos-куку', async () => {
    const start = await app.inject({ method: 'GET', url: '/v1/auth/google' });
    const state = stateCookieOf(start);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/auth/google/callback?code=abc&state=${state}`,
      cookies: { kos_oauth_state: state },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    const sc = String(res.headers['set-cookie']);
    expect(sc).toContain('kos=');
    const user = await repo.findUserByEmail('g@example.com');
    expect(user).toBeTruthy();
    expect(await repo.firstHouseholdOf(user!.id)).toBeTruthy();
  });

  it('повторний вхід тим самим мейлом не плодить юзерів і потрапляє в той самий дім', async () => {
    for (let i = 0; i < 2; i++) {
      const start = await app.inject({ method: 'GET', url: '/v1/auth/google' });
      const state = stateCookieOf(start);
      await app.inject({
        method: 'GET',
        url: `/v1/auth/google/callback?code=abc&state=${state}`,
        cookies: { kos_oauth_state: state },
      });
    }
    const user = await repo.findUserByEmail('g@example.com');
    expect(user).toBeTruthy();
  });

  it('неверифікований email → 403 без сесії', async () => {
    const { app: app2 } = appWith(async () => ({
      email: 'fake@example.com', email_verified: false, name: 'X',
    }));
    await app2.ready();
    const start = await app2.inject({ method: 'GET', url: '/v1/auth/google' });
    const state = stateCookieOf(start);
    const res = await app2.inject({
      method: 'GET',
      url: `/v1/auth/google/callback?code=abc&state=${state}`,
      cookies: { kos_oauth_state: state },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /v1/auth/providers відображає доступність google', async () => {
    const on = await app.inject({ method: 'GET', url: '/v1/auth/providers' });
    expect(on.json()).toEqual({ google: true });
    const bare = buildApp(new InMemoryRepo(), new InMemoryStore(), new ConsoleMailer());
    await bare.ready();
    const off = await bare.inject({ method: 'GET', url: '/v1/auth/providers' });
    expect(off.json()).toEqual({ google: false });
  });
});
