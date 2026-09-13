// Р147/Р149: grammY над чистою логікою telegram.ts. Вебхук (Vercel, telegram-handler.ts)
// і polling (стенд, scripts/telegram-dev.mts) — той самий бот. Поки хід думає —
// «typing» кожні 4 с (Telegram тримає індикатор ~5 с); відповідь — одним
// повідомленням HTML, довше за 4096 — двома-трьома.
import { Bot, type BotConfig } from 'grammy';
import { Agent, fetch as undiciFetch } from 'undici';
import { handleTelegramText, type TelegramDeps } from './telegram.js';

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
