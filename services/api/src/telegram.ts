// Р147 (TELEGRAM-PLAN-0913, PR 1): Telegram як другий канал у чат дому — без
// моделі. Чиста логіка без grammY: тести й стенд ганяють її напряму, вебхук і
// polling (telegram-bot.ts) лише перекладають Update у IncomingText і назад.
//
//   /start <token>  → привʼязка (токен разовий, 15 хв) → привітання на імʼя
//   /start          → «Спершу підключи Telegram у профілі: {url}/profile»
//   /stop           → відключити
//   текст           → хід користувача в сесію ДНЯ людини (той самий репозиторій,
//                     що /v1/chat: getOrCreateSessionForDay → saveMessage →
//                     setSessionTitle), channel: 'telegram', БЕЗ виклику моделі;
//                     відповідь «Записав у розмову».
// Дубль update_id (Telegram повторює доставку) — ігнорується: TTL-кеш у памʼяті.
import { randomBytes } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { deriveSessionTitle, type Repo } from '@kitchen/domain';
import { localDay } from './local-day.js';

export const TELEGRAM_LINK_TTL_MS = 15 * 60_000;

// Username бота — для посилання «Підключити»: з env TELEGRAM_BOT_USERNAME, інакше
// один раз через getMe за TELEGRAM_BOT_TOKEN (кеш на процес); без обох — null,
// і посилання зробити нема з чого (link-token → 503).
let usernameCache: string | null | undefined;
export async function resolveBotUsername(getMe?: () => Promise<{ username?: string }>): Promise<string | null> {
  if (process.env.TELEGRAM_BOT_USERNAME) return process.env.TELEGRAM_BOT_USERNAME;
  if (usernameCache !== undefined) return usernameCache;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const me = getMe ? await getMe() : await (async () => { const { Bot } = await import('grammy'); return new Bot(token).api.getMe(); })();
    usernameCache = me.username ?? null;
  } catch { usernameCache = undefined; return null; }
  return usernameCache;
}
export function resetBotUsernameCache(): void { usernameCache = undefined; }

export interface TelegramDeps {
  repo: Repo;
  /** База для посилання на профіль (APP_URL). */
  appUrl: string;
  now?: () => Date;
}

/** Профіль → «Підключити»: разовий токен і посилання t.me/<bot>?start=<token>. */
export async function createTelegramLinkToken(repo: Repo, user_id: string, username: string, now = new Date()): Promise<{ token: string; url: string; expires_at: string }> {
  const token = randomBytes(24).toString('base64url');
  const expires_at = new Date(now.getTime() + TELEGRAM_LINK_TTL_MS).toISOString();
  await repo.saveTelegramLinkToken({ token, user_id, expires_at, consumed_at: null });
  return { token, url: `https://t.me/${username}?start=${encodeURIComponent(token)}`, expires_at };
}

export interface IncomingText {
  update_id: number;
  telegram_user_id: number;
  chat_id: number;
  text: string;
}

// Дубль update_id — TTL 10 хв у памʼяті процесу (на серверлесі — у межах
// теплого контейнера; цього досить: Telegram повторює за секунди, не дні).
const SEEN_TTL_MS = 10 * 60_000;
const seen = new Map<number, number>();
export function seenUpdate(update_id: number, nowMs = Date.now()): boolean {
  for (const [id, at] of seen) if (nowMs - at > SEEN_TTL_MS) seen.delete(id);
  if (seen.has(update_id)) return true;
  seen.set(update_id, nowMs);
  return false;
}
export function resetSeenUpdates(): void { seen.clear(); }

export const COPY = {
  hello: (name: string) => `Привіт, ${name}. Це кухня дому — тепер усе, що напишеш сюди, зʼявиться в чаті Kitchen OS.`,
  linkFirst: (appUrl: string) => `Спершу підключи Telegram у профілі: ${appUrl}/profile`,
  recorded: 'Записав у розмову',
  stopped: 'Відключив.',
} as const;

/** Один апдейт → текст відповіді боту (null — нічого не відповідати: дубль або порожньо). */
export async function handleTelegramText(deps: TelegramDeps, u: IncomingText): Promise<string | null> {
  const now = deps.now?.() ?? new Date();
  if (seenUpdate(u.update_id, now.getTime())) return null;
  const text = u.text.trim();
  if (!text) return null;

  const start = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/);
  if (start) {
    const token = start[1];
    const row = token ? await deps.repo.consumeTelegramLinkToken(token, now.toISOString()) : null;
    if (!row) return COPY.linkFirst(deps.appUrl);
    await deps.repo.linkTelegram({ telegram_user_id: u.telegram_user_id, user_id: row.user_id, chat_id: u.chat_id, linked_at: now.toISOString(), revoked_at: null });
    const user = await deps.repo.getUser(row.user_id);
    return COPY.hello(user?.name?.trim() || 'привіт');
  }

  const account = await deps.repo.getTelegramByTelegramUser(u.telegram_user_id);
  const linked = account && !account.revoked_at ? account : null;

  if (/^\/stop(?:@\w+)?$/.test(text)) {
    if (linked) await deps.repo.revokeTelegram(linked.user_id, now.toISOString());
    return COPY.stopped;
  }
  if (!linked) return COPY.linkFirst(deps.appUrl);
  if (text.startsWith('/')) return null;   // інші команди — мовчки

  // Хід користувача в сесію дня — рівно те, що робить /v1/chat для тексту,
  // без моделі (routes/chat.ts:328-344).
  const session = await deps.repo.getOrCreateSessionForDay(linked.user_id, localDay(now));
  await deps.repo.saveMessage({
    id: randomUUID(), session_id: session.id, role: 'user', text, card: null, applied: 0,
    created_at: now.toISOString(), channel: 'telegram',
  });
  if (!session.title) {
    const title = deriveSessionTitle(text);
    if (title) await deps.repo.setSessionTitle(session.id, title);
  }
  return COPY.recorded;
}
