// Vercel Cron → api/cron-billing.ts → api-dist/cron-billing.mjs (esbuild, як
// cron-digest). Раз на добу о 03:30 UTC: переходи станів підписки, лист за 3
// дні до кінця пробного, попередження тихим домам і видалення через 30 днів.
//
// Захист той самий, що в дайджесті: Authorization: Bearer CRON_SECRET (Vercel
// шле його сам; env ставить власник). Без секрету — 503, щоб крон не працював
// відкритим.
import './env.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Bot } from 'grammy';
import { pickRepo } from './server.js';
import { pickMailer } from './mailer.js';
import { telegramFetch, botInfoFor } from './telegram-bot.js';
import { runBillingCron } from './billing-cron.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const secret = process.env.CRON_SECRET;
  if (!secret) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":"cron_not_configured"}'); }
  if (req.headers.authorization !== `Bearer ${secret}`) { res.writeHead(401); return res.end(); }
  const t0 = Date.now();
  try {
    const repo = await pickRepo();
    const token = process.env.TELEGRAM_BOT_TOKEN;
    // Акаунти без пошти отримують той самий текст у бот. Немає токена —
    // немає каналу; стани міняються однаково (спек §7).
    const telegramNotify = token
      ? async (user_id: string, text: string) => {
        const acc = await repo.getTelegramByUser(user_id);
        if (!acc || acc.revoked_at || acc.chat_id == null) return;
        const bot = new Bot(token, { botInfo: botInfoFor(token, process.env.TELEGRAM_BOT_USERNAME), client: { fetch: telegramFetch as never } });
        await bot.api.sendMessage(acc.chat_id, text);
      }
      : undefined;
    const summary = await runBillingCron({
      repo, mailer: pickMailer(), appUrl: process.env.APP_URL ?? 'http://localhost:3000', telegramNotify,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, ms: Date.now() - t0, ...summary }));
  } catch (err) {
    console.error('cron-billing failed', String(err));
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: String((err as Error).message ?? err) }));
  }
}
