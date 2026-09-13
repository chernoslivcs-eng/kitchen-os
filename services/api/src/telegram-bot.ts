// Р147/Р149: grammY над чистою логікою telegram.ts. Вебхук (Vercel, telegram-handler.ts)
// і polling (стенд, scripts/telegram-dev.mts) — той самий бот. Поки хід думає —
// «typing» кожні 4 с (Telegram тримає індикатор ~5 с); відповідь — одним
// повідомленням HTML, довше за 4096 — двома-трьома.
import { Bot, InlineKeyboard, type BotConfig, type Context } from 'grammy';
import { Agent, fetch as undiciFetch } from 'undici';
import { handleTelegramText, handleTelegramFile, handleTelegramCallback, type TelegramDeps, type TelegramReply } from './telegram.js';

export const TYPING_EVERY_MS = 4_000;

// Хотфікс №3 (13.09): з лямбди Vercel getMe висів (bot.init timeout 5000ms), хоча
// егрес до інших хостів є — підозра на IPv6/DNS у undici Node 20 (api.telegram.org
// має AAAA). Тому: (1) botInfo задаємо самі з токена й username — grammY не робить
// init/getMe взагалі; (2) усі запити до Telegram — через undici fetch з Agent, що
// зʼєднується лише по IPv4 (family: 4).
// family: 4 — опція net.connect; у типах undici 6 її нема, але вона проходить у connector.
export const telegramAgent = new Agent({ connect: { family: 4 } as unknown as NonNullable<ConstructorParameters<typeof Agent>[0]>['connect'] });
export const telegramFetch: typeof fetch = (input, init) =>
  undiciFetch(input as Parameters<typeof undiciFetch>[0], { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher: telegramAgent }) as unknown as Promise<Response>;

/** botInfo без getMe: id — з токена (до двокрапки), username — з env або переданий. */
export function botInfoFor(token: string, username?: string | null): BotConfig<never>['botInfo'] | undefined {
  const id = Number(token.split(':')[0]);
  if (!username || !Number.isFinite(id)) return undefined;
  return { id, is_bot: true, first_name: 'Kitchen OS', username, can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false, allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false };
}

export function makeTelegramBot(token: string, deps: TelegramDeps): Bot {
  const bot = new Bot(token, {
    botInfo: botInfoFor(token, deps.botUsername ?? process.env.TELEGRAM_BOT_USERNAME),
    client: { fetch: telegramFetch as never },
  });
  // Р150: файл Telegram → байти (getFile + file-роут), тим самим IPv4-fetch.
  const download = deps.downloadFile ?? (async (file_id: string) => {
    const f = await bot.api.getFile(file_id);
    if (!f.file_path) throw new Error('telegram getFile: no file_path');
    const r = await telegramFetch(`https://api.telegram.org/file/bot${token}/${f.file_path}`);
    if (!r.ok) throw new Error(`telegram file download: ${r.status}`);
    return { buffer: Buffer.from(await r.arrayBuffer()), content_type: r.headers.get('content-type') };
  });
  const fileDeps: TelegramDeps = { ...deps, downloadFile: download };

  const withTyping = async (ctx: Context, run: () => Promise<TelegramReply>) => {
    const typing = () => ctx.replyWithChatAction('typing').catch(() => { /* індикатор — не критично */ });
    void typing();
    const timer = setInterval(() => { void typing(); }, TYPING_EVERY_MS);
    let reply: TelegramReply = null;
    try { reply = await run(); } finally { clearInterval(timer); }
    if (!reply) return;
    for (const [i, m] of reply.messages.entries()) {
      const last = i === reply.messages.length - 1;
      const keyboard = last && reply.keyboard ? InlineKeyboard.from(reply.keyboard.map((row) => row.map((b) => InlineKeyboard.text(b.text, b.data)))) : undefined;
      try {
        await ctx.reply(m, { ...(reply.html ? { parse_mode: 'HTML' as const } : {}), ...(keyboard ? { reply_markup: keyboard } : {}) });
      } catch {
        // HTML не пройшов (несподіваний тег у відповіді моделі) — те саме простим текстом.
        await ctx.reply(m.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'), keyboard ? { reply_markup: keyboard } : undefined);
      }
    }
  };

  bot.on('message:text', (ctx) => withTyping(ctx, () => handleTelegramText(deps, {
    update_id: ctx.update.update_id, telegram_user_id: ctx.from.id, chat_id: ctx.chat.id, text: ctx.message.text,
  })));
  bot.on('message:photo', (ctx) => {
    const best = ctx.message.photo.at(-1)!;   // найбільший розмір — останній
    return withTyping(ctx, () => handleTelegramFile(fileDeps, {
      update_id: ctx.update.update_id, telegram_user_id: ctx.from.id, chat_id: ctx.chat.id,
      source: 'photo', file_id: best.file_id, file_size: best.file_size, caption: ctx.message.caption,
    }));
  });
  bot.on('message:document', (ctx) => {
    const d = ctx.message.document;
    return withTyping(ctx, () => handleTelegramFile(fileDeps, {
      update_id: ctx.update.update_id, telegram_user_id: ctx.from.id, chat_id: ctx.chat.id,
      source: 'document', file_id: d.file_id, file_size: d.file_size, mime_type: d.mime_type, caption: ctx.message.caption,
    }));
  });
  bot.on('callback_query:data', async (ctx) => {
    const r = await handleTelegramCallback(deps, { update_id: ctx.update.update_id, telegram_user_id: ctx.from.id, data: ctx.callbackQuery.data });
    await ctx.answerCallbackQuery().catch(() => { /* прострочений запит — не критично */ });
    if (!r) return;
    // Кнопки зникають, повідомлення редагується: список лишається, статус — унизу.
    const text = ctx.callbackQuery.message && 'text' in ctx.callbackQuery.message ? ctx.callbackQuery.message.text : '';
    await ctx.editMessageText(text ? `${text}\n\n${r.status}` : r.status, { reply_markup: undefined }).catch(() => ctx.reply(r.status));
  });
  return bot;
}
