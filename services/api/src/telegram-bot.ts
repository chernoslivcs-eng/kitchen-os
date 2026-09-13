// Р147/Р149: grammY над чистою логікою telegram.ts. Вебхук (Vercel, telegram-handler.ts)
// і polling (стенд, scripts/telegram-dev.mts) — той самий бот. Поки хід думає —
// «typing» кожні 4 с (Telegram тримає індикатор ~5 с); відповідь — одним
// повідомленням HTML, довше за 4096 — двома-трьома.
import { Bot } from 'grammy';
import { handleTelegramText, type TelegramDeps } from './telegram.js';

export const TYPING_EVERY_MS = 4_000;

export function makeTelegramBot(token: string, deps: TelegramDeps): Bot {
  const bot = new Bot(token);
  bot.on('message:text', async (ctx) => {
    const typing = () => ctx.replyWithChatAction('typing').catch(() => { /* індикатор — не критично */ });
    void typing();
    const timer = setInterval(() => { void typing(); }, TYPING_EVERY_MS);
    let reply;
    try {
      reply = await handleTelegramText(deps, {
        update_id: ctx.update.update_id,
        telegram_user_id: ctx.from.id,
        chat_id: ctx.chat.id,
        text: ctx.message.text,
      });
    } finally {
      clearInterval(timer);
    }
    if (!reply) return;
    for (const m of reply.messages) {
      try {
        await ctx.reply(m, reply.html ? { parse_mode: 'HTML' } : undefined);
      } catch {
        // HTML не пройшов (несподіваний тег у відповіді моделі) — те саме простим текстом.
        await ctx.reply(m.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
      }
    }
  });
  return bot;
}
