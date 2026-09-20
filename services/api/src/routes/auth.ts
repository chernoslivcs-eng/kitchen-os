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
import { requestChallenge, verifyChallenge, verifyEmailAttach, resolveSession, logoutSession, openSession, verifyTelegramWebToken, CHALLENGE_TTL_MS, SESSION_TTL_MS } from '@kitchen/domain';
import type { Mailer } from '../mailer.js';
import { makeRateLimiter, type RateLimitCfg } from '../rate-limit.js';
import { tooMany } from '../too-many.js';

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
      tooMany(reply, limiter, key, 'auth');
      return reply;
    }
  };

  app.post<{ Body: { email?: string; next?: string; mode?: 'start' | 'login' } }>(
    '/v1/auth/request',
    { preHandler: limitCheck },
    async (req, reply) => {
      const email = req.body?.email?.trim().toLowerCase();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return reply.code(400).send({ error: 'valid email required' });
      }
      // AUTH-BRIEF-0915: «Вхід» ніколи не створює акаунт. Виняток із
      // навмисної анти-енумерації цього роута (коментар угорі файла) —
      // людина сама обрала «Вхід», їй чесно потрібно знати, що ключ
      // невідомий; лист НЕ шлемо і challenge НЕ заводимо.
      if (req.body?.mode === 'login' && !(await repo.findUserByEmail(email))) {
        return reply.send({ error: 'no_account' });
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

  // PR 2 (TELEGRAM-AUTH-PAY-PLAN-0915): «Додати пошту» до акаунта без неї
  // (Telegram-only). Авторизований маршрут — ставить requestChallenge на ту
  // саму пошту, лінк веде на /v1/auth/verify?...&attach=1, а не на логін.
  app.post<{ Body: { email?: string } }>(
    '/v1/auth/email/attach/request',
    { preHandler: limitCheck },
    async (req, reply) => {
      const raw = (req.cookies as Record<string, string | undefined>)[COOKIE_NAME];
      const ctx = await resolveSession(repo, raw ?? null);
      if (!ctx) return reply.code(401).send({ error: 'unauthorized' });
      const email = req.body?.email?.trim().toLowerCase();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return reply.code(400).send({ error: 'valid email required' });
      }
      // Злиття (15.09): зайняту пошту НЕ відсікаємо тут — лист іде, і саме
      // відкритий лінк доводить володіння; verify запише конфлікт, а профіль
      // запропонує обʼєднати акаунти (GET /v1/account/conflict).
      const { raw_token } = await requestChallenge(repo, {
        email,
        ip: req.ip,
        user_agent: req.headers['user-agent'] ?? null,
      });
      const link = `${baseUrl()}/v1/auth/verify?token=${encodeURIComponent(raw_token)}&attach=1`;
      await mailer.sendMagicLink({ to: email, link, expires_in_min: CHALLENGE_TTL_MS / 60_000 });
      return reply.code(202).send({ ok: true });
    },
  );

  app.get<{ Querystring: { token?: string; next?: string; attach?: string } }>('/v1/auth/verify', async (req, reply) => {
    const raw = req.query.token;
    if (!raw) return reply.code(400).send({ error: 'token required' });
    if (req.query.attach === '1') {
      const cookieRaw = (req.cookies as Record<string, string | undefined>)[COOKIE_NAME];
      const ctx = await resolveSession(repo, cookieRaw ?? null);
      const out = await verifyEmailAttach(repo, raw, ctx?.user_id ?? null);
      if (!out.ok) {
        const code = out.reason === 'expired' || out.reason === 'consumed' ? 410
          : out.reason === 'email_taken' ? 409
          : out.reason === 'no_session' ? 401
          : 404;
        const wantsHtmlPage = /text\/html/i.test(String(req.headers.accept ?? ''));
        if (wantsHtmlPage && (out.reason === 'expired' || out.reason === 'consumed')) {
          return reply.redirect(`/link/${out.reason}`);
        }
        // Злиття (15.09): пошта чужа, але володіння доведено — у профіль, там рядок «Обʼєднати?».
        if (wantsHtmlPage && out.reason === 'email_taken') return reply.redirect('/profile');
        return reply.code(code).send(out.reason === 'email_taken' ? { error: out.reason, conflict_user_id: out.conflict_user_id } : { error: out.reason });
      }
      const wantsHtml = /text\/html/i.test(String(req.headers.accept ?? ''));
      if (wantsHtml) return reply.redirect('/profile');
      return reply.send({ ok: true });
    }
    const out = await verifyChallenge(repo, raw, req.ip, req.headers['user-agent'] ?? null);
    if (!out.ok) {
      const code = out.reason === 'expired' ? 410 : out.reason === 'consumed' ? 410 : 404;
      // Крок Е1: по лінку з листа приходить БРАУЗЕР, і сирий JSON `{"error":
      // "expired"}` — це те, чого людина не має бачити ніколи. Віддаємо їй
      // екран: два різні, бо «запізнився» і «вже спрацював» — різні новини, і
      // друга не про помилку взагалі. Клієнтам, що просять JSON (і тестам),
      // лишається той самий 410 з тим самим тілом.
      const wantsHtmlPage = /text\/html/i.test(String(req.headers.accept ?? ''));
      if (wantsHtmlPage && (out.reason === 'expired' || out.reason === 'consumed')) {
        return reply.redirect(`/link/${out.reason}`);
      }
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

  // Лінк входу з бота. E (20.09): токен багаторазовий на 24 год (telegram-web-token.ts),
  // бо Telegram iOS відкриває лінки у вбудованому браузері з окремими куками. Якщо в
  // браузері вже є сесія того ж user — нову не відкриваємо, лише redirect на next
  // (відносний шлях; типово /app). Мертвий токен → 410; браузеру — /link/expired?kind=telegram
  // (перевидати можна лише з бота: /web).
  app.get<{ Querystring: { token?: string; next?: string } }>('/v1/auth/telegram', async (req, reply) => {
    const raw = req.query.token;
    if (!raw) return reply.code(400).send({ error: 'token required' });
    const out = await verifyTelegramWebToken(repo, raw);
    if (!out.ok) {
      const wantsHtmlPage = /text\/html/i.test(String(req.headers.accept ?? ''));
      if (wantsHtmlPage && out.reason !== 'not_found') return reply.redirect('/link/expired?kind=telegram');
      return reply.code(out.reason === 'not_found' ? 404 : 410).send({ error: out.reason });
    }
    const next = req.query.next;
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
    const cookieRaw = (req.cookies as Record<string, string | undefined>)[COOKIE_NAME];
    const current = await resolveSession(repo, cookieRaw ?? null);
    if (current?.user_id === out.user_id) return reply.redirect(safeNext);
    const { raw_cookie } = await openSession(repo, out.user_id, req.ip, req.headers['user-agent'] ?? null);
    reply.setCookie(COOKIE_NAME, raw_cookie, { httpOnly: true, secure: isSecure(), sameSite: 'lax', path: '/', maxAge: SESSION_TTL_MS / 1000 });
    return reply.redirect(safeNext);
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    const raw = (req.cookies as Record<string, string | undefined>)[COOKIE_NAME];
    // E: вихід відкликає й лінк із бота — інакше він відкривав би сесію далі.
    const ctx = raw ? await resolveSession(repo, raw) : null;
    if (ctx) await repo.revokeTelegramWebTokens(ctx.user_id, new Date().toISOString());
    if (raw) await logoutSession(repo, raw);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.code(204).send();
  });
}
