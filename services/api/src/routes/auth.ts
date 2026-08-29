// Автентифікація magic-link. Три ендпоінти, жодного пароля.
//   POST /v1/auth/request { email }        → 202 (навіть якщо email не існує — не ліком інфо про юзерів)
//   GET  /v1/auth/verify?token=<raw>       → 302 / 410 / 404 (лінк одноразовий)
//   POST /v1/auth/logout                    → 204, чистить cookie
//
// Cookie: httpOnly, sameSite=lax, secure у проді, path=/. Ключ — 'kos'.
// Не пишемо сирий токен нікуди, крім листа. У БД тільки SHA-256.
//
// Rate limit на /request: 5/15хв на IP+email. Мета — не заспамити email-бокс
// і не витратити квоту мейлера через простий скрипт. Битий email теж рахується
// (інакше scanner підбирає адреси, не бачачи 429).

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { requestChallenge, verifyChallenge, logoutSession, CHALLENGE_TTL_MS, SESSION_TTL_MS } from '@kitchen/domain';
import type { Mailer } from '../mailer.js';
import { makeRateLimiter, type RateLimitCfg } from '../rate-limit.js';

export const COOKIE_NAME = 'kos';

function isSecure(): boolean {
  return process.env.NODE_ENV === 'production';
}

function baseUrl(): string {
  return process.env.APP_URL ?? 'http://localhost:3000';
}

export interface AuthRoutesOpts {
  rateLimit?: RateLimitCfg;
}

export function authRoutes(app: FastifyInstance, repo: Repo, mailer: Mailer, opts: AuthRoutesOpts = {}) {
  const cfg = opts.rateLimit ?? { max: 5, windowMs: 15 * 60_000 };
  const limiter = makeRateLimiter(cfg);

  const limitCheck = async (req: FastifyRequest, reply: FastifyReply) => {
    const email = ((req.body as { email?: string })?.email ?? '').toLowerCase().trim();
    const key = `${req.ip}:${email}`;
    if (!limiter.check(key)) {
      reply.code(429).send({ error: 'too many requests' });
      return reply;
    }
  };

  app.post<{ Body: { email?: string; next?: string } }>(
    '/v1/auth/request',
    { preHandler: limitCheck },
    async (req, reply) => {
      const email = req.body?.email?.trim().toLowerCase();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return reply.code(400).send({ error: 'valid email required' });
      }
      // ?next йде наскрізь від фронту: браузер лишає його в URL SignIn, той передає
      // сюди, ми — вшиваємо у magic-link. Гарантія, що після клацання лінка юзер
      // повернеться туди, звідки пішов авторизуватись, а не зʼїде на дефолт /app.
      const nextRaw = req.body?.next;
      const next = nextRaw && nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : null;
      const { raw_token } = await requestChallenge(repo, {
        email,
        ip: req.ip,
        user_agent: req.headers['user-agent'] ?? null,
      });
      let link = `${baseUrl()}/v1/auth/verify?token=${encodeURIComponent(raw_token)}`;
      if (next) link += `&next=${encodeURIComponent(next)}`;
      await mailer.sendMagicLink({ to: email, link, expires_in_min: CHALLENGE_TTL_MS / 60_000 });
      return reply.code(202).send({ ok: true });
    },
  );

  app.get<{ Querystring: { token?: string; next?: string } }>('/v1/auth/verify', async (req, reply) => {
    const raw = req.query.token;
    if (!raw) return reply.code(400).send({ error: 'token required' });
    const out = await verifyChallenge(repo, raw, req.ip, req.headers['user-agent'] ?? null);
    if (!out.ok) {
      const code = out.reason === 'expired' ? 410 : out.reason === 'consumed' ? 410 : 404;
      return reply.code(code).send({ error: out.reason });
    }
    reply.setCookie(COOKIE_NAME, out.result.raw_cookie, {
      httpOnly: true,
      secure: isSecure(),
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });
    // Явний ?next=/… — перемагає завжди. Інакше: браузер (Accept: text/html) → редирект
    // на корінь фронту; клієнт, який хоче JSON, — отримує JSON. Це дає нормальний UX
    // при кліку по лінку з листа й не ламає тести, які ходять без Accept-заголовка.
    const next = req.query.next;
    if (next && next.startsWith('/')) return reply.redirect(next);
    const wantsHtml = /text\/html/i.test(String(req.headers.accept ?? ''));
    if (wantsHtml) return reply.redirect('/');
    return reply.send({ ok: true, user_id: out.result.user_id, household_id: out.result.household_id });
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    const raw = (req.cookies as Record<string, string | undefined>)[COOKIE_NAME];
    if (raw) await logoutSession(repo, raw);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.code(204).send();
  });
}
