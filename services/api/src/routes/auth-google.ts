// Google OAuth 2.0 (authorization code) — другий спосіб входу поруч із
// magic-link. Google лише ДОВОДИТЬ володіння мейлом; далі юзер їде тим самим
// доменним флоу signInWithVerifiedEmail, що й лінк із листа.
//
//   GET /v1/auth/google           → 302 на consent-екран Google (+ state-кука проти CSRF)
//   GET /v1/auth/google/callback  → обмін code на профіль → сесія → редирект на фронт
//   GET /v1/auth/providers        → { google: boolean } — фронт ховає/показує кнопку
//
// Обмін коду ізольований в exchange-функцію: у тестах підставляється стаб,
// у проді — реальний POST на oauth2.googleapis.com. id_token приходить прямим
// TLS-каналом від Google, тому підпис не перевіряємо — декодуємо payload.

import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { signInWithVerifiedEmail, SESSION_TTL_MS } from '@kitchen/domain';
import { COOKIE_NAME } from './auth.js';

export interface GoogleProfile {
  email: string;
  email_verified: boolean;
  name?: string;
}

export interface GoogleAuthOpts {
  clientId: string;
  clientSecret: string;
  exchange?: (code: string, redirectUri: string) => Promise<GoogleProfile>;
}

const STATE_COOKIE = 'kos_oauth_state';

function isSecure(): boolean {
  return process.env.NODE_ENV === 'production';
}

function baseUrl(): string {
  return process.env.APP_URL ?? 'http://localhost:3000';
}

// Прод-обмін: code → токени → payload id_token (email, email_verified, name).
function makeRealExchange(clientId: string, clientSecret: string) {
  return async (code: string, redirectUri: string): Promise<GoogleProfile> => {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) throw new Error(`google token exchange failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { id_token?: string };
    if (!data.id_token) throw new Error('google response has no id_token');
    const payloadB64 = data.id_token.split('.')[1] ?? '';
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as {
      email?: string; email_verified?: boolean; name?: string;
    };
    if (!payload.email) throw new Error('google id_token has no email');
    return { email: payload.email, email_verified: payload.email_verified === true, name: payload.name };
  };
}

export function googleAuthRoutes(app: FastifyInstance, repo: Repo, opts?: GoogleAuthOpts) {
  app.get('/v1/auth/providers', async () => ({ google: Boolean(opts) }));

  if (!opts) return;
  const exchange = opts.exchange ?? makeRealExchange(opts.clientId, opts.clientSecret);
  const redirectUri = () => `${baseUrl()}/v1/auth/google/callback`;

  app.get('/v1/auth/google', async (_req, reply) => {
    const state = randomBytes(24).toString('base64url');
    reply.setCookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: isSecure(),
      sameSite: 'lax',
      path: '/',
      maxAge: 600, // стейт живе 10 хв — консент довше не триває
    });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', opts.clientId);
    url.searchParams.set('redirect_uri', redirectUri());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/v1/auth/google/callback',
    async (req, reply) => {
      const expected = (req.cookies as Record<string, string | undefined>)[STATE_COOKIE];
      reply.clearCookie(STATE_COOKIE, { path: '/' });
      // Юзер натиснув «скасувати» на консенті — повертаємо на вхід без драми.
      if (req.query.error) return reply.redirect('/signin');
      if (!req.query.code || !req.query.state || !expected || req.query.state !== expected) {
        return reply.code(400).send({ error: 'state mismatch' });
      }
      const profile = await exchange(req.query.code, redirectUri());
      if (!profile.email_verified) {
        return reply.code(403).send({ error: 'email not verified by google' });
      }
      const email = profile.email.toLowerCase();
      const result = await signInWithVerifiedEmail(
        repo, email, profile.name || email.split('@')[0] || 'Anon',
        req.ip, req.headers['user-agent'] ?? null,
      );
      reply.setCookie(COOKIE_NAME, result.raw_cookie, {
        httpOnly: true,
        secure: isSecure(),
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_TTL_MS / 1000,
      });
      return reply.redirect('/');
    },
  );
}
