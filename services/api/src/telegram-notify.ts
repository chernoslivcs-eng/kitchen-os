// Повідомлення людині в бот: один будівник на крон і на разові скрипти.
//
// Правило з обох спеків (2026-09-25 §7, 2026-10-01 §5): хто з поштою — лист,
// хто з Telegram — у бот, у кого немає ні того, ні того — нічого, а стан
// міняється однаково. Доти це правило жило лише в хендлері крону, і
// `end-beta.mts` його просто не мав: на день переходу 7 людей із 31 мовчки не
// отримали б нічого, а скрипт надрукував би «повідомлень у бот 0» — так, ніби
// таких людей немає зовсім.
import { Bot } from 'grammy';
import type { Repo } from '@kitchen/domain';
import { telegramFetch, botInfoFor } from './telegram-bot.js';

export type TelegramNotify = (user_id: string, text: string) => Promise<void>;

/**
 * `undefined`, коли токена немає: це не помилка, а відсутність каналу — той,
 * хто викликає, мусить уміти працювати без нього.
 *
 * `send` існує для тестів: мережу в них не піднімаємо, а перевіряти треба
 * саме відбір — кому слати, а кому ні.
 */
export function makeTelegramNotify(
  repo: Repo,
  token: string | undefined = process.env.TELEGRAM_BOT_TOKEN,
  send?: (chat_id: number, text: string) => Promise<void>,
): TelegramNotify | undefined {
  if (!token) return undefined;
  const deliver = send ?? (async (chat_id: number, text: string) => {
    const bot = new Bot(token, { botInfo: botInfoFor(token, process.env.TELEGRAM_BOT_USERNAME), client: { fetch: telegramFetch as never } });
    await bot.api.sendMessage(chat_id, text);
  });
  return async (user_id, text) => {
    const acc = await repo.getTelegramByUser(user_id);
    // Відкликана привʼязка (/stop) і акаунт із віджета без chat_id — це не
    // «нема куди слати через збій», а свідома відсутність адреси.
    if (!acc || acc.revoked_at || acc.chat_id == null) return;
    await deliver(acc.chat_id, text);
  };
}
