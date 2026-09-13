// Р147/Р149 (TELEGRAM-PLAN-0913, PR 1–2): Telegram як другий канал у чат дому.
// Чиста логіка без grammY: тести й стенд ганяють її напряму, вебхук і polling
// (telegram-bot.ts) лише перекладають Update у IncomingText і назад.
//
//   /start <token>  → привʼязка (токен разовий, 15 хв) → привітання на імʼя
//   /start          → «Спершу підключи Telegram у профілі: {url}/profile»
//   /stop           → відключити
//   текст           → ТОЙ САМИЙ хід чату, що за POST /v1/chat (chat-turn.ts:
//                     сесія дня людини, модель, картки, обидва повідомлення з
//                     channel: 'telegram'); відповідь — reply + картка текстом +
//                     «Відкрити у вебі: {url}/app». Помилка ходу → текст E1
//                     (REPLY_FAILED з ErrorState/copy.ts), у Sentry — як у вебі
//                     (incident усередині ходу).
// Дубль update_id (Telegram повторює доставку) — ігнорується: TTL-кеш у памʼяті.
// Ліміт — 30 ходів на хвилину на Telegram-користувача (як у вебі на user_id).
import { randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Repo, Card } from '@kitchen/domain';
import type { AttachmentStore } from './attachment-store.js';
import { runChatTurn, ChatTurnHttpError, type ChatRouteOpts, type ChatTurnInput, type ChatTurnOutput } from './chat-turn.js';
import { settleTelemetry, type TelemetryHost } from './telemetry.js';
import { flushSentry } from './sentry.js';
import { makeRateLimiter } from './rate-limit.js';

export const TELEGRAM_LINK_TTL_MS = 15 * 60_000;
/** Ліміт Telegram: 4096 знаків на повідомлення. */
export const TELEGRAM_MSG_MAX = 4096;

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
  /** База для посилань (APP_URL): профіль і «Відкрити у вебі». */
  appUrl: string;
  /** Для ходу чату (вкладення в PR 3); без нього — лише текст. */
  store?: AttachmentStore;
  /** Руки чату (Сільпо тощо) — як у chatRoute; типово порожньо. */
  chatOpts?: ChatRouteOpts;
  log?: FastifyBaseLogger;
  /** Тести: власний хід замість runChatTurn. */
  turn?: (input: ChatTurnInput) => Promise<ChatTurnOutput>;
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

const limiter = makeRateLimiter({ max: 30, windowMs: 60_000 });

export const COPY = {
  hello: (name: string) => `Привіт, ${name}. Це кухня дому — тепер усе, що напишеш сюди, зʼявиться в чаті Kitchen OS.`,
  linkFirst: (appUrl: string) => `Спершу підключи Telegram у профілі: ${appUrl}/profile`,
  stopped: 'Відключив.',
  /** E1, ErrorState/copy.ts REPLY_FAILED — той самий рядок, що показує веб при падінні моделі. */
  replyFailed: 'Я подумав. Відповідь — ні. Повторити?',
  tooMany: 'Дай хвилину — і продовжимо.',
  openWeb: (appUrl: string) => `Відкрити у вебі: ${appUrl}/app`,
} as const;

/** Екранування для parse_mode: 'HTML' (Telegram приймає лише &, <, >). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Повідомлення довше за 4096 — по межі рядка/речення, на два-три. */
export function splitTelegramText(text: string, max = TELEGRAM_MSG_MAX): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('. ', max) + 1;
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

const ing = (i: { p?: string; n?: string; v?: number; u?: string }) => [i.p ?? i.n ?? '', i.v != null ? `${i.v}${i.u ? ' ' + i.u : ''}` : ''].filter(Boolean).join(' · ');

/** Картка → простий текст (PR 2: без кнопок — це PR 3). Повертає null для карток, яким тут нема місця. */
export function renderCardText(card: Card | null | undefined): string | null {
  if (!card) return null;
  switch (card.type) {
    case 'proposal':
      return 'Варіанти:\n' + card.items.map((it, i) => `${i + 1}) ${it.title}${it.desc ? ' · ' + it.desc : ''}`).join('\n');
    case 'recipe': {
      const r = card.recipe;
      return `${r.t} · ${r.tm} хв · ${r.sv} порц.\n` + r.ing.map((i) => `— ${ing(i)}`).join('\n');
    }
    case 'recipe_link':
      return card.recipe ? `${card.recipe.t} · ${card.recipe.tm} хв · ${card.recipe.sv} порц.` : card.title;
    case 'intake_diff': {
      const rows = card.ops.map((o) => {
        if (o.op === 'add') return `+ ${o.label}${o.value != null ? ` · ${o.value}${o.unit ? ' ' + o.unit : ''}` : ''}`;
        if (o.op === 'deplete') return `− ${o.label}`;
        if (o.op === 'open') return `відкрито: ${o.label}`;
        if (o.op === 'rename') return `${o.label} → ${o.to}`;
        return `${o.label} (уточнено)`;
      });
      return `Розібрав: ${rows.length} ${rows.length === 1 ? 'позиція' : rows.length < 5 ? 'позиції' : 'позицій'}\n` + rows.join('\n');
    }
    case 'shopping':
      return 'Список:\n' + card.items.map((i) => `${i.op === 'remove' ? '−' : '+'} ${i.label}${i.v != null ? ` · ${i.v}${i.u ? ' ' + i.u : ''}` : ''}${i.note ? ' · ' + i.note : ''}`).join('\n');
    case 'event':
      return card.ops.map((o) => `${o.op === 'remove' ? '−' : o.op === 'done' ? '✓' : '+'} ${o.title ?? o.id ?? ''}`.trim()).join('\n') || null;
    case 'period':
      return card.title ? `${card.title}${card.resolved ? ` · ${card.resolved.from} — ${card.resolved.to}` : ''}` : null;
    default:
      return null;
  }
}

/** Відповідь ходу → повідомлення для Telegram (HTML, ≤ 4096 кожне). */
export function renderTurnMessages(out: { reply: string | null; card: Card | null }, appUrl: string): string[] {
  const parts: string[] = [];
  if (out.reply) parts.push(escapeHtml(out.reply));
  const cardText = renderCardText(out.card);
  if (cardText) parts.push(escapeHtml(cardText));
  if (!parts.length) return [];
  parts.push(escapeHtml(COPY.openWeb(appUrl)));
  return splitTelegramText(parts.join('\n\n'));
}

export type TelegramReply = { messages: string[]; html: boolean } | null;

/** Один апдейт → повідомлення боту (null — нічого не відповідати: дубль або порожньо).
 *  Довгий крок (модель) — усередині; хто кличе, той тримає «typing» (telegram-bot.ts). */
export async function handleTelegramText(deps: TelegramDeps, u: IncomingText): Promise<TelegramReply> {
  const now = deps.now?.() ?? new Date();
  if (seenUpdate(u.update_id, now.getTime())) return null;
  const text = u.text.trim();
  if (!text) return null;
  const plain = (s: string): TelegramReply => ({ messages: [s], html: false });

  const start = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/);
  if (start) {
    const token = start[1];
    const row = token ? await deps.repo.consumeTelegramLinkToken(token, now.toISOString()) : null;
    if (!row) return plain(COPY.linkFirst(deps.appUrl));
    await deps.repo.linkTelegram({ telegram_user_id: u.telegram_user_id, user_id: row.user_id, chat_id: u.chat_id, linked_at: now.toISOString(), revoked_at: null });
    const user = await deps.repo.getUser(row.user_id);
    return plain(COPY.hello(user?.name?.trim() || 'привіт'));
  }

  const account = await deps.repo.getTelegramByTelegramUser(u.telegram_user_id);
  const linked = account && !account.revoked_at ? account : null;

  if (/^\/stop(?:@\w+)?$/.test(text)) {
    if (linked) await deps.repo.revokeTelegram(linked.user_id, now.toISOString());
    return plain(COPY.stopped);
  }
  if (!linked) return plain(COPY.linkFirst(deps.appUrl));
  if (text.startsWith('/')) return null;   // інші команди — мовчки
  if (!limiter.check(String(u.telegram_user_id))) return plain(COPY.tooMany);

  // Той самий хід, що POST /v1/chat. Хто написав — привʼязана людина; дім — її.
  const user = await deps.repo.getUser(linked.user_id);
  if (!user) return plain(COPY.linkFirst(deps.appUrl));
  const household_id = await householdOf(deps.repo, linked.user_id);
  if (!household_id) return plain(COPY.linkFirst(deps.appUrl));
  const log = deps.log ?? (console as unknown as FastifyBaseLogger);
  const host: TelemetryHost = { log, telemetry: [] };
  try {
    const turn = deps.turn ?? ((input: ChatTurnInput) => runChatTurn(deps.repo, deps.store ?? noStore, deps.chatOpts ?? {}, input));
    const out = await turn({ user: { user_id: linked.user_id, household_id }, text, channel: 'telegram', host, log });
    const messages = renderTurnMessages(out, deps.appUrl);
    return messages.length ? { messages, html: true } : null;
  } catch (err) {
    // 502 model_unavailable і решта — той самий текст, що бачить веб (E1); інцидент
    // уже записано всередині ходу, як і для вебу.
    if (!(err instanceof ChatTurnHttpError)) log.error({ err: String(err), telegram_user_id: u.telegram_user_id }, 'telegram-turn-failed');
    return plain(COPY.replyFailed);
  } finally {
    // У вебі це робить onSend-хук fastify; тут хука нема — чекаємо самі, інакше
    // інцидент і app_event губляться на серверлесі.
    await settleTelemetry(host);
    await flushSentry(1000);
  }
}

// Дім людини — як у verifyChallenge (auth.ts): перший household_member.
async function householdOf(repo: Repo, user_id: string): Promise<string | null> {
  return (await repo.firstHouseholdOf(user_id)) ?? null;
}

// Без вкладень (PR 3) сховище ходу не потрібне — але тип вимагає.
const noStore: AttachmentStore = {
  put: async () => { throw new Error('attachments: not in telegram PR 2'); },
  get: async () => null,
} as unknown as AttachmentStore;
