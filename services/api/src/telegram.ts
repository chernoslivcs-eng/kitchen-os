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
import { randomUUID } from 'node:crypto';
import { resolveRecipeLabels, applyCard, dismissCard, type Repo, type Card, type Recipe, type AttachmentKind } from '@kitchen/domain';
import type { AttachmentStore } from './attachment-store.js';
import { runChatTurn, ChatTurnHttpError, type ChatRouteOpts, type ChatTurnInput, type ChatTurnOutput } from './chat-turn.js';
import { settleTelemetry, type TelemetryHost } from './telemetry.js';
import { flushSentry } from './sentry.js';
import { makeRateLimiter } from './rate-limit.js';
import { transcribeTelegramAudio, type SttResult } from './telegram-stt.js';
import { loadPrompt } from '@kitchen/prompts';

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
  /** Username бота для botInfo без getMe (типово з env TELEGRAM_BOT_USERNAME). */
  botUsername?: string | null;
  /** Р150: завантажити файл Telegram за file_id (бот — через getFile + telegramFetch; тести — стаб). */
  downloadFile?: (file_id: string) => Promise<{ buffer: Buffer; content_type: string | null }>;
  /** Р151: голос → текст (типово OpenRouter, telegram-stt.ts; тести — стаб). */
  stt?: (buffer: Buffer, content_type: string | null) => Promise<SttResult>;
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
  // Р150 (постановка 14.09): кнопки й підписи для вкладень — нові слова, на рішення власника.
  toPantry: 'У комору',
  notNeeded: 'Не треба',
  added: (n: number) => `Додав у комору · ${n}`,
  notAdded: 'Не додав',
  fileUnsupported: 'Такий файл не читаю — фото, PDF або текст',
  fileTooBig: 'Завеликий файл — до 20 МБ',
  photoHint: 'Якщо чек не розібрався — надішли його як файл, без стиснення',
  // Р151 (постановка 14.09)
  heard: (text: string) => `Почув: «${text}»`,
  voiceTooLong: 'Задовге — скажи коротше',
  voiceUnclear: 'Не розібрав — напиши текстом',
} as const;

/** Аудіо, надіслане як «Файл» (document): m4a/mp3/ogg/wav → голосовий шлях, не «не читаю». */
export function isAudioMime(content_type: string | null | undefined): boolean {
  return /^audio\//i.test(content_type ?? '');
}
/** Ліміти голосового: 2 хв / 5 МБ (постановка). */
export const TELEGRAM_VOICE_MAX_SEC = 120;
export const TELEGRAM_VOICE_MAX_BYTES = 5 * 1024 * 1024;

/** Ліміт файлу — як у вебі (server.ts multipart fileSize). */
export const TELEGRAM_FILE_MAX = 20 * 1024 * 1024;
/** Що приймаємо з Telegram: фото (image/jpeg), документи image/*, PDF, plain text. */
export function attachmentKindOf(content_type: string | null | undefined): AttachmentKind | null {
  const ct = (content_type ?? '').toLowerCase();
  if (ct.startsWith('image/')) return 'image';
  if (ct === 'application/pdf') return 'pdf';
  if (ct === 'text/plain') return 'text';
  return null;
}

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

// Кількість — те саме правило, що apps/web/src/lib/units.ts formatQty (веб імпортувати
// не можемо): «250 г», від 1000 г — «1,2 кг», від 1000 мл — «1,5 л», одиниці українською.
const UNIT_UK: Record<string, string> = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт', pack: 'пач' };
export function formatQty(value?: number | null, unit?: string | null): string {
  if (value == null) return '';
  const key = unit?.toLowerCase();
  if ((key === 'g' || key === 'ml') && value >= 1000) {
    const big = Math.round(value / 100) / 10;
    const num = Number.isInteger(big) ? String(big) : big.toFixed(1).replace('.', ',');
    return `${num} ${key === 'g' ? 'кг' : 'л'}`;
  }
  const u = key ? (UNIT_UK[key] ?? unit ?? '') : '';
  return u ? `${value} ${u}` : String(value);
}
const pluralUk = (n: number, forms: [string, string, string]) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? forms[2] : b > 1 && b < 5 ? forms[1] : b === 1 ? forms[0] : forms[2]; };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const ingName = (i: { p?: string; n?: string }) => i.n ?? i.p ?? '';
const ing = (i: { p?: string; n?: string; v?: number; u?: string }) => [ingName(i), formatQty(i.v, i.u)].filter(Boolean).join(' · ');

/** Повний рецепт як панель «Рецепт» у вебі (Recipe.tsx), HTML: заголовок + склад і кроки —
 *  двома блоками, щоб довгий рецепт розкладати на два повідомлення, не рвучи крок. */
export function renderRecipeBlocks(r: Recipe): { head: string; steps: string } {
  const total = r.ing.length;
  const have = r.ing.filter((i) => !!i.p).length;
  const meta = [
    `${r.tm} хв`,
    r.nu?.kcal ? `≈ ${r.nu.kcal} ккал` : null,
    `${r.sv} ${pluralUk(r.sv, ['порція', 'порції', 'порцій'])}`,
    `є ${have} з ${total}`,
  ].filter(Boolean).join(' · ');
  const notes = [r.d, r.rk].filter((s) => s && s.trim()).map((s) => `<i>${escapeHtml(s!.trim())}</i>`);
  const head = [
    `<b>${escapeHtml(r.t)}</b>`,
    escapeHtml(meta),
    ...notes,
    '',
    `<b>Склад · ${total}</b>`,
    ...r.ing.map((i) => `• ${escapeHtml(ingName(i))}${i.v != null ? ` — ${escapeHtml(formatQty(i.v, i.u))}` : ''}${i.p ? '' : ' — нема'}`),
  ].join('\n');
  const fill = (c: string) => c.replace(/\{(\d+)\}/g, (_, k: string) => ingName(r.ing[Number(k)] ?? {}) || `{${k}}`);
  const steps = [
    `<b>Кроки · ${r.st.length}</b>`,
    ...r.st.map((s, i) => `${i + 1}. ${escapeHtml(s.t)}${s.s ? ` · ${mmss(s.s)}` : ''}\n   ${escapeHtml(fill(s.c))}`),
  ].join('\n');
  return { head, steps };
}

/** Картка → простий текст (PR 2: без кнопок — це PR 3). Повертає null для карток, яким тут нема місця. */
export function renderCardText(card: Card | null | undefined): string | null {
  if (!card) return null;
  switch (card.type) {
    case 'proposal':
      return 'Варіанти:\n' + card.items.map((it, i) => `${i + 1}) ${it.title}${it.desc ? ' · ' + it.desc : ''}`).join('\n');
    case 'recipe':
    case 'recipe_link': {
      // Повний рецепт — у renderTurnMessages (свій HTML і розбиття); тут — лише без рецепта.
      if (card.type === 'recipe_link' && !card.recipe) return card.title;
      const r = card.type === 'recipe' ? card.recipe : card.recipe!;
      return `${r.t} · ${r.tm} хв · ${r.sv} порц.\n` + r.ing.map((i) => `— ${ing(i)}`).join('\n');
    }
    case 'intake_diff': {
      const rows = card.ops.map((o) => {
        if (o.op === 'add') return `+ ${o.label}${o.value != null ? ` · ${formatQty(o.value, o.unit)}` : ''}`;
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
  const open = escapeHtml(COPY.openWeb(appUrl));
  const recipe = out.card?.type === 'recipe' ? out.card.recipe : out.card?.type === 'recipe_link' ? out.card.recipe : undefined;
  if (recipe) {
    // Власник 14.09: після вибору варіанта — повний рецепт, як панель «Рецепт» у вебі.
    // Одне повідомлення, коли ≤ 4096; інакше «заголовок + склад» і «кроки» (крок не рветься).
    const { head, steps } = renderRecipeBlocks(recipe);
    const reply = out.reply ? escapeHtml(out.reply) + '\n\n' : '';
    const whole = `${reply}${head}\n\n${steps}\n\n${open}`;
    if (whole.length <= TELEGRAM_MSG_MAX) return [whole];
    const first = `${reply}${head}`;
    const rest = `${steps}\n\n${open}`;
    return [...splitTelegramText(first), ...splitByBlocks(rest, /\n(?=\d+\. )/)];
  }
  const parts: string[] = [];
  if (out.reply) parts.push(escapeHtml(out.reply));
  const cardText = renderCardText(out.card);
  if (cardText) parts.push(escapeHtml(cardText));
  if (!parts.length) return [];
  parts.push(open);
  return splitTelegramText(parts.join('\n\n'));
}

/** Розбити по межах блоків (кроків), не рвучи блок; занадто довгий блок — як звичайний текст. */
export function splitByBlocks(text: string, boundary: RegExp, max = TELEGRAM_MSG_MAX): string[] {
  const blocks = text.split(boundary);
  const out: string[] = [];
  let cur = '';
  for (const b of blocks) {
    const next = cur ? `${cur}\n${b}` : b;
    if (next.length <= max) { cur = next; continue; }
    if (cur) out.push(cur);
    if (b.length <= max) cur = b; else { out.push(...splitTelegramText(b, max)); cur = ''; }
  }
  if (cur) out.push(cur);
  return out;
}

/** Клавіатура — до ОСТАННЬОГО повідомлення; data — `apply:<card_id>` / `dismiss:<card_id>`. */
export type TelegramReply = { messages: string[]; html: boolean; keyboard?: { text: string; data: string }[][] } | null;

export interface IncomingFile {
  update_id: number;
  telegram_user_id: number;
  chat_id: number;
  /** photo — найбільший розмір; document — як є. */
  source: 'photo' | 'document';
  file_id: string;
  file_size?: number | null;
  mime_type?: string | null;
  caption?: string | null;
}

/** Фото або документ → той самий attachment-store і той самий хід із вкладенням, що /v1/chat;
 *  intake_diff лишається pending і питає кнопками «У комору / Не треба» (callback → applyCard / dismissCard). */
export async function handleTelegramFile(deps: TelegramDeps, u: IncomingFile): Promise<TelegramReply> {
  const now = deps.now?.() ?? new Date();
  if (seenUpdate(u.update_id, now.getTime())) return null;
  const plain = (s: string): TelegramReply => ({ messages: [s], html: false });
  const account = await deps.repo.getTelegramByTelegramUser(u.telegram_user_id);
  const linked = account && !account.revoked_at ? account : null;
  if (!linked) return plain(COPY.linkFirst(deps.appUrl));
  if (!limiter.check(String(u.telegram_user_id))) return plain(COPY.tooMany);
  const content_type = u.source === 'photo' ? 'image/jpeg' : (u.mime_type ?? null);
  if (u.source === 'document' && isAudioMime(content_type)) {
    seen.delete(u.update_id);   // той самий апдейт іде голосовим шляхом
    return handleTelegramVoice(deps, { update_id: u.update_id, telegram_user_id: u.telegram_user_id, chat_id: u.chat_id, file_id: u.file_id, file_size: u.file_size, mime_type: content_type });
  }
  const kind = attachmentKindOf(content_type);
  if (!kind) return plain(COPY.fileUnsupported);
  if ((u.file_size ?? 0) > TELEGRAM_FILE_MAX) return plain(COPY.fileTooBig);
  if (!deps.downloadFile || !deps.store) return plain(COPY.replyFailed);
  const household_id = await householdOf(deps.repo, linked.user_id);
  if (!household_id) return plain(COPY.linkFirst(deps.appUrl));
  const log = deps.log ?? (console as unknown as FastifyBaseLogger);
  const host: TelemetryHost = { log, telemetry: [] };
  try {
    const file = await deps.downloadFile(u.file_id);
    if (file.buffer.length > TELEGRAM_FILE_MAX) return plain(COPY.fileTooBig);
    // Рівно те, що робить POST /v1/attachments (routes/attachments.ts): store.put + saveAttachment.
    const id = randomUUID();
    const stored = await deps.store.put(id, file.buffer, content_type ?? 'application/octet-stream');
    await deps.repo.saveAttachment({
      id, message_id: null, household_id, user_id: linked.user_id, kind, url: stored.url,
      content_type, bytes: stored.bytes, hint: null, created_at: now.toISOString(),
    });
    const turn = deps.turn ?? ((input: ChatTurnInput) => runChatTurn(deps.repo, deps.store ?? noStore, deps.chatOpts ?? {}, input));
    const out = await turn({
      user: { user_id: linked.user_id, household_id }, text: u.caption?.trim() || undefined,
      attachments: [{ id }], channel: 'telegram', attachmentApply: 'pending', host, log,
    });
    const card = out.card;
    if (card?.type === 'intake_diff' && out.card_id && card.ops.length) {
      const text = [
        out.reply ? escapeHtml(out.reply) : null,
        escapeHtml(renderCardText(card)!),
        escapeHtml(COPY.openWeb(deps.appUrl)),
      ].filter(Boolean).join('\n\n');
      return { messages: splitTelegramText(text), html: true, keyboard: [[{ text: COPY.toPantry, data: `apply:${out.card_id}` }, { text: COPY.notNeeded, data: `dismiss:${out.card_id}` }]] };
    }
    // Нічого не розібрав (нема картки або порожній список): стиснуте фото — підказка про файл.
    const messages = renderTurnMessages({ reply: out.reply, card }, deps.appUrl);
    const nothing = !card || (card.type === 'intake_diff' && !card.ops.length);
    if (u.source === 'photo' && nothing) messages.push(escapeHtml(COPY.photoHint));
    return messages.length ? { messages, html: true } : plain(COPY.photoHint);
  } catch (err) {
    if (!(err instanceof ChatTurnHttpError)) log.error({ err: String(err), telegram_user_id: u.telegram_user_id }, 'telegram-file-failed');
    return plain(COPY.replyFailed);
  } finally {
    await settleTelemetry(host);
    await flushSentry(1000);
  }
}

export interface IncomingCallback { update_id: number; telegram_user_id: number; data: string }

/** Кнопка під карткою → той самий applyCard / dismissCard, що у вебі. Повертає рядок статусу
 *  для редагування повідомлення (кнопки знімаються); null — дубль або чужа/невідома кнопка. */
export async function handleTelegramCallback(deps: TelegramDeps, u: IncomingCallback): Promise<{ status: string } | null> {
  const now = deps.now?.() ?? new Date();
  if (seenUpdate(u.update_id, now.getTime())) return null;
  const m = u.data.match(/^(apply|dismiss):([0-9a-f-]{36})$/);
  if (!m) return null;
  const account = await deps.repo.getTelegramByTelegramUser(u.telegram_user_id);
  const linked = account && !account.revoked_at ? account : null;
  if (!linked) return { status: COPY.linkFirst(deps.appUrl) };
  try {
    if (m[1] === 'apply') {
      const r = await applyCard(deps.repo, m[2]!, [], linked.user_id);
      return { status: COPY.added(r.applied) };
    }
    await dismissCard(deps.repo, m[2]!, linked.user_id);
    return { status: COPY.notAdded };
  } catch (err) {
    // Уже застосовано/відхилено, чужа картка — кнопки просто знімаємо.
    (deps.log ?? (console as unknown as FastifyBaseLogger)).warn({ err: String(err), data: u.data }, 'telegram-callback');
    return { status: COPY.notAdded };
  }
}

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
  return textTurn(deps, linked.user_id, u.telegram_user_id, text);
}

/** Той самий хід, що POST /v1/chat, для привʼязаної людини; дім — її. Спільне для тексту й голосу. */
async function textTurn(deps: TelegramDeps, user_id: string, telegram_user_id: number, text: string, prefix?: string): Promise<TelegramReply> {
  const plain = (s: string): TelegramReply => ({ messages: [s], html: false });
  const user = await deps.repo.getUser(user_id);
  if (!user) return plain(COPY.linkFirst(deps.appUrl));
  const household_id = await householdOf(deps.repo, user_id);
  if (!household_id) return plain(COPY.linkFirst(deps.appUrl));
  const log = deps.log ?? (console as unknown as FastifyBaseLogger);
  const host: TelemetryHost = { log, telemetry: [] };
  try {
    const turn = deps.turn ?? ((input: ChatTurnInput) => runChatTurn(deps.repo, deps.store ?? noStore, deps.chatOpts ?? {}, input));
    const out = await turn({ user: { user_id, household_id }, text, channel: 'telegram', host, log });
    // Рецепт показує на комору через ing.p (uuid) — як і веб, підставляємо назви партій.
    const card = await withRecipeLabels(deps.repo, household_id, out.card);
    const messages = renderTurnMessages({ reply: out.reply, card }, deps.appUrl);
    if (prefix) messages.unshift(escapeHtml(prefix));
    return messages.length ? { messages, html: true } : null;
  } catch (err) {
    // 502 model_unavailable і решта — той самий текст, що бачить веб (E1); інцидент
    // уже записано всередині ходу, як і для вебу.
    if (!(err instanceof ChatTurnHttpError)) log.error({ err: String(err), telegram_user_id }, 'telegram-turn-failed');
    return { messages: [...(prefix ? [prefix] : []), COPY.replyFailed], html: false };
  } finally {
    // У вебі це робить onSend-хук fastify; тут хука нема — чекаємо самі, інакше
    // інцидент і app_event губляться на серверлесі.
    await settleTelemetry(host);
    await flushSentry(1000);
  }
}

export interface IncomingVoice {
  update_id: number;
  telegram_user_id: number;
  chat_id: number;
  file_id: string;
  duration?: number | null;
  file_size?: number | null;
  mime_type?: string | null;
}

/** Голосове/аудіо → getFile → транскрипція (telegram-stt.ts) → «Почув: «…»» + звичайний хід. */
export async function handleTelegramVoice(deps: TelegramDeps, u: IncomingVoice): Promise<TelegramReply> {
  const now = deps.now?.() ?? new Date();
  if (seenUpdate(u.update_id, now.getTime())) return null;
  const plain = (s: string): TelegramReply => ({ messages: [s], html: false });
  const account = await deps.repo.getTelegramByTelegramUser(u.telegram_user_id);
  const linked = account && !account.revoked_at ? account : null;
  if (!linked) return plain(COPY.linkFirst(deps.appUrl));
  if (!limiter.check(String(u.telegram_user_id))) return plain(COPY.tooMany);
  if ((u.duration ?? 0) > TELEGRAM_VOICE_MAX_SEC || (u.file_size ?? 0) > TELEGRAM_VOICE_MAX_BYTES) return plain(COPY.voiceTooLong);
  if (!deps.downloadFile) return plain(COPY.voiceUnclear);
  const log = deps.log ?? (console as unknown as FastifyBaseLogger);
  const started = Date.now();
  let heard: string;
  try {
    const file = await deps.downloadFile(u.file_id);
    if (file.buffer.length > TELEGRAM_VOICE_MAX_BYTES) return plain(COPY.voiceTooLong);
    const stt = await (deps.stt ?? transcribeTelegramAudio)(file.buffer, file.content_type ?? u.mime_type ?? null);
    // usage — окремий call telegram_stt (token_usage), профіль smart як у чаті.
    const household_id = await householdOf(deps.repo, linked.user_id);
    await deps.repo.logTokenUsage({
      id: randomUUID(), user_id: linked.user_id, household_id, call: 'telegram_stt', profile: 'smart', model: stt.model,
      prompt_version: loadPrompt().version, mode: 'live', input_tokens: stt.usage.input, output_tokens: stt.usage.output, cached_tokens: 0,
      latency_ms: Date.now() - started, prompt_hash: stt.prompt_hash, prompt_chars: null, message_id: null, session_id: null,
      cache_write_tokens: null, created_at: new Date().toISOString(),
    });
    heard = stt.text.trim();
  } catch (err) {
    log.warn({ err: String(err), telegram_user_id: u.telegram_user_id }, 'telegram-stt-failed');
    return plain(COPY.voiceUnclear);
  }
  if (!heard) return plain(COPY.voiceUnclear);
  return textTurn(deps, linked.user_id, u.telegram_user_id, heard, COPY.heard(heard));
}

async function withRecipeLabels(repo: Repo, household_id: string, card: Card | null): Promise<Card | null> {
  if (!card) return null;
  if (card.type === 'recipe') return { ...card, recipe: resolveRecipeLabels(card.recipe, await repo.listBatches(household_id)) };
  if (card.type === 'recipe_link' && card.recipe) return { ...card, recipe: resolveRecipeLabels(card.recipe, await repo.listBatches(household_id)) };
  return card;
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
