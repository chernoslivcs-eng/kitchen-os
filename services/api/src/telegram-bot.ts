// Р147: grammY над чистою логікою telegram.ts. Вебхук (Vercel, telegram-handler.ts)
// і polling (стенд, scripts/telegram-dev.mts) — той самий бот.
import { Bot } from 'grammy';
import { handleTelegramText, type TelegramDeps } from './telegram.js';

export function makeTelegramBot(token: string, deps: TelegramDeps): Bot {
  const bot = new Bot(token);
  bot.on('message:text', async (ctx) => {
    const reply = await handleTelegramText(deps, {
      update_id: ctx.update.update_id,
      telegram_user_id: ctx.from.id,
      chat_id: ctx.chat.id,
      text: ctx.message.text,
    });
    if (reply) await ctx.reply(reply);
  });
  return bot;
}
