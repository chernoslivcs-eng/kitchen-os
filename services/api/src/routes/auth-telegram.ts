// Вхід через Telegram-бота з лендингу (TELEGRAM-AUTH-PAY-PLAN-0915, PR 2-веб;
// хотфікс 15.09 — ЗАМІНА Login Widget: на десктопі «Запит на вхід» від
// Telegram не приходив, на мобайлі власний popup мовчки блокувався iOS
// Safari). Замість підпису HMAC від віджета — бот сам підтверджує особу
// через /start; веб лише створює й опитує challenge.
//
//   GET  /v1/auth/providers        → { google, telegram, telegramBotId? } —
//                                     той самий роут, auth-google.ts
//   POST /v1/auth/telegram/begin   → challenge kind 'tg_login' без user_id,
//                                     { token, url: t.me/<bot>?start=login_<token> }
//   GET  /v1/auth/telegram/poll    → { status: 'pending' | 'ok' | 'expired' };
//                                     на 'ok' — та сама cookie-сесія, що й
//                                     усюди (COOKIE_NAME, SESSION_TTL_MS)
//
// Сам /start login_<token> — телеграм.ts (services/api/src/telegram.ts),
// не тут: там attachTelegramLoginUser записує user_id у challenge, коли
// людина тисне Start у застосунку.
import type { FastifyInstance } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { beginTelegramLogin, pollTelegramLogin, SESSION_TTL_MS } from '@kitchen/domain';
import { COOKIE_NAME } from './auth.js';

export interface TelegramAuthOpts {
  botToken: string;
  /** Числовий bot_id — лишається в providers для сумісності, фронт його вже не використовує (url будує begin). */
  botId?: string;
  botUsername: string;
}

function isSecure(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function telegramAuthRoutes(app: FastifyInstance, repo: Repo, opts?: TelegramAuthOpts) {
  if (!opts) return;

  app.post<{ Body: { mode?: 'start' | 'login' } | null }>('/v1/auth/telegram/begin', async (req, reply) => {
    // Злиття (15.09), контракт із лендингом: mode 'login' — /start без акаунта його не створює (poll → 'no_account').
    const mode = req.body?.mode === 'login' ? 'login' : 'start';
    const { raw_token } = await beginTelegramLogin(repo, req.ip, req.headers['user-agent'] ?? null, mode);
    const url = `https://t.me/${opts.botUsername}?start=${encodeURIComponent(`login_${raw_token}`)}`;
    return reply.send({ token: raw_token, url });
  });

  app.get<{ Querystring: { token?: string } }>('/v1/auth/telegram/poll', async (req, reply) => {
    const token = req.query.token;
    if (!token) return reply.code(400).send({ error: 'token required' });
    const out = await pollTelegramLogin(repo, token, req.ip, req.headers['user-agent'] ?? null);
    if (out.status !== 'ok') return reply.send({ status: out.status });
    reply.setCookie(COOKIE_NAME, out.result.raw_cookie, {
      httpOnly: true,
      secure: isSecure(),
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });
    return reply.send({ status: 'ok' });
  });
}
