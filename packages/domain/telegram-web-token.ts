// Лінк «Відкрити у вебі» з бота (E, 20.09). Досі це був auth_challenge kind
// 'telegram': 15 хв, разовий. Telegram на iOS відкриває лінки у ВБУДОВАНОМУ
// браузері з окремими куками — кожен тап був новим входом, а повторний тап по
// тому самому лінку вів на «другий раз він не вміє». За вечір власника —
// 130 tg_web_link.
//
// Тепер: один живий токен на акаунт, 24 год, багаторазовий. Кожен перехід
// ставить cookie-сесію (або лишає наявну, якщо вона того ж user_id). Новий
// лінк, поки токен живий, — той самий токен. Logout і «відвʼязати Telegram»
// відкликають його.
//
// У базі лежить лише sha256-хеш. Щоб перевидати ТОЙ САМИЙ сирий токен, не
// зберігаючи його, сирий = HMAC(secret, id рядка): секрет знає лише сервер,
// хеш у базі не дає відновити лінк. Зміна секрету → хеш не збігається →
// видаємо новий рядок (старі лінки тихо вмирають, а не ламають вхід).
//
// Ризик усвідомлений (рішення ГОЛОВНОГО ЧАТУ 20.09): лінк живе в приватному
// чаті людини 24 год.

import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { Repo } from './repo.js';
import type { TelegramWebTokenRow } from './types.js';

export const TELEGRAM_WEB_TOKEN_TTL_MS = 24 * 60 * 60_000;

const sha256 = (s: string) => createHash('sha256').update(s, 'utf-8').digest('hex');
const rawFor = (secret: string, id: string) => createHmac('sha256', secret).update(id).digest('base64url');

export interface WebToken { raw_token: string; expires_at: string; reused: boolean }

/** Живий токен акаунта або новий. */
export async function getOrCreateTelegramWebToken(repo: Repo, user_id: string, secret: string, now = new Date()): Promise<WebToken> {
  const nowIso = now.toISOString();
  const live = await repo.getLiveTelegramWebToken(user_id, nowIso);
  if (live) {
    const raw = rawFor(secret, live.id);
    if (sha256(raw) === live.token_hash) return { raw_token: raw, expires_at: live.expires_at, reused: true };
    // Секрет змінився — старий рядок не перевидати; відкликаємо, нижче — новий.
    await repo.revokeTelegramWebTokens(user_id, nowIso);
  }
  const id = randomUUID();
  const raw = rawFor(secret, id);
  const row: TelegramWebTokenRow = {
    id, user_id, token_hash: sha256(raw), created_at: nowIso,
    expires_at: new Date(now.getTime() + TELEGRAM_WEB_TOKEN_TTL_MS).toISOString(), revoked_at: null,
  };
  await repo.saveTelegramWebToken(row);
  return { raw_token: raw, expires_at: row.expires_at, reused: false };
}

export type WebTokenVerdict =
  | { ok: true; user_id: string; household_id: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'revoked' };

/** Перехід за лінком. Токен НЕ споживається — він багаторазовий до кінця життя. */
export async function verifyTelegramWebToken(repo: Repo, raw_token: string, now = new Date()): Promise<WebTokenVerdict> {
  const row = await repo.getTelegramWebTokenByHash(sha256(raw_token));
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.revoked_at) return { ok: false, reason: 'revoked' };
  if (new Date(row.expires_at).getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  const household_id = await repo.firstHouseholdOf(row.user_id);
  if (!household_id) return { ok: false, reason: 'not_found' };
  return { ok: true, user_id: row.user_id, household_id };
}
