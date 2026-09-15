// Telegram Login Widget — третій спосіб входу поруч із magic-link і Google
// (TELEGRAM-AUTH-PAY-PLAN-0915, PR 2-веб). Офіційний віджет
// (https://telegram.org/js/telegram-widget.js) не вбудовується як кнопка —
// фронт ховає його й викликає `Telegram.Login.auth(...)` сам, а видима
// кнопка своя (SignInForm.tsx). Тут — лише перевірка підпису й вхід.
//
//   GET  /v1/auth/providers          → { google, telegram, telegramBotId? } —
//                                       telegram-поля тут-таки, поруч із google
//                                       (той самий роут, auth-google.ts)
//   POST /v1/auth/telegram/widget    → перевірка hash, вхід, cookie-сесія
//
// Підпис віджета (Telegram Login Widget, офіційна схема):
//   data_check_string = усі поля payload КРІМ hash, "key=value" по рядку,
//     відсортовані за ключем, зʼєднані "\n";
//   secret_key = SHA256(bot_token)  (сирі байти, не hex);
//   очікуваний hash = HMAC-SHA256(secret_key, data_check_string) у hex.
// auth_date — не старший за добу: захист від повторного використання
// перехопленого payload.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { signInWithTelegram, SESSION_TTL_MS } from '@kitchen/domain';
import { COOKIE_NAME } from './auth.js';

export interface TelegramWidgetPayload {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export interface TelegramAuthOpts {
  botToken: string;
  /** Числовий bot_id для `Telegram.Login.auth` на фронті — перша частина токена до «:». */
  botId?: string;
  botUsername?: string;
}

const AUTH_DATE_MAX_AGE_SEC = 24 * 60 * 60;

function isSecure(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function verifyTelegramWidgetHash(payload: Record<string, unknown>, botToken: string): boolean {
  const { hash, ...rest } = payload as Record<string, unknown> & { hash?: unknown };
  if (typeof hash !== 'string' || !hash) return false;
  const dataCheckString = Object.keys(rest)
    .filter((k) => rest[k] !== undefined && rest[k] !== null)
    .sort()
    .map((k) => `${k}=${String(rest[k])}`)
    .join('\n');
  const secretKey = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const gotBuf = Buffer.from(hash, 'hex');
  if (expectedBuf.length !== gotBuf.length) return false;
  return timingSafeEqual(expectedBuf, gotBuf);
}

export function telegramAuthRoutes(app: FastifyInstance, repo: Repo, opts?: TelegramAuthOpts) {
  if (!opts) return;

  app.post<{ Body: Partial<TelegramWidgetPayload> }>('/v1/auth/telegram/widget', async (req, reply) => {
    const body = req.body ?? {};
    if (typeof body.id !== 'number' || typeof body.first_name !== 'string' || typeof body.auth_date !== 'number' || typeof body.hash !== 'string') {
      return reply.code(400).send({ error: 'invalid payload' });
    }
    if (!verifyTelegramWidgetHash(body, opts.botToken)) {
      return reply.code(403).send({ error: 'bad signature' });
    }
    const ageSec = Date.now() / 1000 - body.auth_date;
    if (ageSec > AUTH_DATE_MAX_AGE_SEC || ageSec < -60) {
      return reply.code(403).send({ error: 'stale auth_date' });
    }

    const result = await signInWithTelegram(
      repo,
      { telegram_user_id: body.id, chat_id: null, first_name: body.first_name, username: body.username ?? null },
      req.ip,
      req.headers['user-agent'] ?? null,
    );
    reply.setCookie(COOKIE_NAME, result.raw_cookie, {
      httpOnly: true,
      secure: isSecure(),
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });
    return reply.send({ ok: true, next: '/app' });
  });
}
