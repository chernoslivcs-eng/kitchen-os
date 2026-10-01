// Vercel Cron → api/cron-billing.ts → api-dist/cron-billing.mjs (esbuild, як
// cron-digest). Раз на добу о 03:30 UTC: переходи станів підписки, лист за 3
// дні до кінця пробного, попередження тихим домам і видалення через 30 днів.
//
// Захист той самий, що в дайджесті: Authorization: Bearer CRON_SECRET (Vercel
// шле його сам; env ставить власник). Без секрету — 503, щоб крон не працював
// відкритим.
import './env.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pickRepo } from './server.js';
import { pickMailer } from './mailer.js';
import { makeTelegramNotify } from './telegram-notify.js';
import { runBillingCron } from './billing-cron.js';
import { lazyBillingProvider } from './billing/pick-provider.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const secret = process.env.CRON_SECRET;
  if (!secret) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":"cron_not_configured"}'); }
  if (req.headers.authorization !== `Bearer ${secret}`) { res.writeHead(401); return res.end(); }
  const t0 = Date.now();
  try {
    const repo = await pickRepo();
    // Акаунти без пошти отримують той самий текст у бот. Немає токена —
    // немає каналу; стани міняються однаково (спек §7). Будівник спільний із
    // разовими скриптами: правило «кому слати» мусить бути одне.
    const telegramNotify = makeTelegramNotify(repo);
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const summary = await runBillingCron({
      repo, mailer: pickMailer(), appUrl, telegramNotify, billing: lazyBillingProvider(appUrl),
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, ms: Date.now() - t0, ...summary }));
  } catch (err) {
    console.error('cron-billing failed', String(err));
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: String((err as Error).message ?? err) }));
  }
}
