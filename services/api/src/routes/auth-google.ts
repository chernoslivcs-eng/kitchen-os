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
import { signInWithVerifiedEmail, cleanSignupMarks, signupMarksFromSearch, signupMarksToSearch, SESSION_TTL_MS } from '@kitchen/domain';
import { COOKIE_NAME } from './auth.js';
import { captureIncident } from '../sentry.js';

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
/**
 * Скільки живе state-кука. 15 хв, не 10: у Google між нашим редиректом і
 * поверненням людина встигає вибрати акаунт, увійти в нього або завести
 * новий — на десять хвилин це не завжди вкладається, і тоді колбек
 * приходить без куки, тобто виглядає як підробка.
 */
const STATE_TTL_SEC = 900;
/**
 * Куди вести людину замість тексту помилки. Маршруту `/signin` у вебі НЕМАЄ
 * (App.tsx: там спрацьовує NotFoundPage), тож ведемо на лендінг до форми
 * входу — тим самим шляхом, що й гілка «акаунта не знайдено».
 */
const SIGNIN_ANCHOR = '#l3-signin';
const SIGNIN_URL = `/${SIGNIN_ANCHOR}`;
// AUTH-BRIEF-0915: «Реєстрація / Вхід» — той самий OAuth-флоу, лише режим
// пронести крізь редирект на Google і назад. Окрема кука (не в state,
// щоб не чіпати CSRF-порівняння 1:1) із тим самим TTL, що state.
const MODE_COOKIE = 'kos_oauth_mode';
// Мітки джерела реєстрації — так само окремою кукою з тим самим TTL: сторінка
// йде на Google, і донести їх до колбека більше нема чим. Технічна кука на час
// одного входу (httpOnly, 15 хв, гаситься в колбеку), не для стеження.
const SRC_COOKIE = 'kos_oauth_src';

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

// PR 2 (TELEGRAM-AUTH-PAY-PLAN-0915): /v1/auth/providers — той самий роут,
// що ховає/показує кнопку Google, тепер каже й про Telegram; окремого
// ендпоінта не заводимо (Fastify не дозволить два GET на той самий шлях).
export interface TelegramProvidersInfo {
  botId?: string;
  botUsername?: string;
}

export function googleAuthRoutes(app: FastifyInstance, repo: Repo, opts?: GoogleAuthOpts, telegram?: TelegramProvidersInfo) {
  app.get('/v1/auth/providers', async () => ({
    google: Boolean(opts),
    telegram: Boolean(telegram?.botId),
    telegramBotId: telegram?.botId ?? null,
  }));

  if (!opts) return;
  const exchange = opts.exchange ?? makeRealExchange(opts.clientId, opts.clientSecret);
  const redirectUri = () => `${baseUrl()}/v1/auth/google/callback`;

  app.get<{ Querystring: Record<string, unknown> & { mode?: string } }>('/v1/auth/google', async (req, reply) => {
    const state = randomBytes(24).toString('base64url');
    reply.setCookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: isSecure(),
      sameSite: 'lax',
      path: '/',
      maxAge: STATE_TTL_SEC,
    });
    if (req.query.mode === 'login') {
      reply.setCookie(MODE_COOKIE, 'login', { httpOnly: true, secure: isSecure(), sameSite: 'lax', path: '/', maxAge: STATE_TTL_SEC });
    }
    const src = signupMarksToSearch(cleanSignupMarks(req.query));
    if (src) {
      reply.setCookie(SRC_COOKIE, src, { httpOnly: true, secure: isSecure(), sameSite: 'lax', path: '/', maxAge: STATE_TTL_SEC });
    }
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
      const mode = (req.cookies as Record<string, string | undefined>)[MODE_COOKIE] === 'login' ? 'login' : 'start';
      // Читаємо ДО перевірки state, гасимо завжди: кука не мусить пережити колбек.
      const marks = signupMarksFromSearch((req.cookies as Record<string, string | undefined>)[SRC_COOKIE] ?? '');
      reply.clearCookie(STATE_COOKIE, { path: '/' });
      reply.clearCookie(MODE_COOKIE, { path: '/' });
      reply.clearCookie(SRC_COOKIE, { path: '/' });
      // Юзер натиснув «скасувати» на консенті — повертаємо на вхід без драми.
      if (req.query.error) return reply.redirect(SIGNIN_URL);
      if (!req.query.code || !req.query.state || !expected || req.query.state !== expected) {
        // Людині — форма входу з рядком, а не `{"error":"state mismatch"}`:
        // вона не зробила нічого поганого, і текст помилки їй ні про що.
        //
        // У Sentry — ознаки, а не значення: сам state порівнювати постфактум
        // нема з чим, а в логах він був би зайвим секретом. `had_cookie`
        // відрізняє «кука не доїхала» (наш випадок 27.09: старий хост
        // vercel.app тримав куку в себе) від «кука є, але чужа» — це різні
        // діагнози з різним лікуванням.
        captureIncident('guard', 'oauth-state-mismatch', {
          had_cookie: Boolean(expected),
          matched: Boolean(expected) && req.query.state === expected,
          has_code: Boolean(req.query.code),
          host: req.headers.host ?? null,
          // Без query: у referer Google лишає свої параметри.
          referer: (req.headers.referer ?? '').split('?')[0] || null,
        });
        return reply.redirect(`/?err=oauth_state${SIGNIN_ANCHOR}`);
      }
      const profile = await exchange(req.query.code, redirectUri());
      if (!profile.email_verified) {
        return reply.code(403).send({ error: 'email not verified by google' });
      }
      const email = profile.email.toLowerCase();
      // AUTH-BRIEF-0915: «Вхід» ніколи не створює — той самий виняток із
      // анти-енумерації, що POST /v1/auth/request (людина сама обрала «Вхід»).
      if (mode === 'login' && !(await repo.findUserByEmail(email))) {
        return reply.redirect('/?err=no_account&via=google');
      }
      const result = await signInWithVerifiedEmail(
        repo, email, profile.name || email.split('@')[0] || 'Anon',
        req.ip, req.headers['user-agent'] ?? null,
        { via: 'google', marks },
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
