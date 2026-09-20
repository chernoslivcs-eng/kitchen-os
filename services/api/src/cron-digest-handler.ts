// Vercel Cron → api/cron-digest.ts → api-dist/cron-digest.mjs (esbuild, як
// telegram-handler). Раз на добу о 15:00 UTC (18:00 Київ улітку, 17:00 узимку) —
// обмеження Hobby-плану (щогодинний крон деплой відхиляє); логіка за поясом
// лишається (вікно 17..19 у shouldSendDigest), при переїзді на щогодинний
// будильник змінюється лише розклад у vercel.json. Захист — Authorization: Bearer CRON_SECRET
// (Vercel шле його сам; env ставить власник). Без секрету в env — 503, щоб
// крон не працював «відкритим».
import './env.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Bot, InlineKeyboard } from 'grammy';
import { pickRepo, pickStore } from './server.js';
import { telegramFetch, botInfoFor } from './telegram-bot.js';
import { runDigestCron } from './digest.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const secret = process.env.CRON_SECRET;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!secret || !token) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":"cron_not_configured"}'); }
  if (req.headers.authorization !== `Bearer ${secret}`) { res.writeHead(401); return res.end(); }
  const t0 = Date.now();
  const log = console as unknown as import('fastify').FastifyBaseLogger;
  try {
    const repo = await pickRepo();
    const bot = new Bot(token, { botInfo: botInfoFor(token, process.env.TELEGRAM_BOT_USERNAME), client: { fetch: telegramFetch as never } });
    const summary = await runDigestCron({
      repo, store: pickStore(), chatOpts: {}, log, appUrl: process.env.APP_URL ?? 'http://localhost:3000',
      send: async (chat_id, text, keyboard) => {
        const reply_markup = InlineKeyboard.from(keyboard.map((row) => row.map((b) => (b.url ? InlineKeyboard.url(b.text, b.url) : InlineKeyboard.text(b.text, b.data!)))));
        await bot.api.sendMessage(chat_id, text, { reply_markup });
      },
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, ms: Date.now() - t0, ...summary }));
  } catch (err) {
    console.error('cron-digest failed', String(err));
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: String((err as Error).message ?? err) }));
  }
}
