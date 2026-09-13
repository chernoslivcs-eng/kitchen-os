// Р147: окрема Vercel-функція для вебхука Telegram (api/telegram.ts → api-dist/telegram.mjs).
// Секрет вебхука перевіряє grammY (заголовок X-Telegram-Bot-Api-Secret-Token —
// той самий рядок, що в setWebhook secret_token). Без токена або секрету — 503.
import './env.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { webhookCallback } from 'grammy';
import { pickRepo } from './server.js';
import { makeTelegramBot } from './telegram-bot.js';

type H = (req: IncomingMessage, res: ServerResponse) => Promise<unknown>;
let cached: H | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":"telegram_not_configured"}'); }
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
  if (!cached) {
    const repo = await pickRepo();
    const bot = makeTelegramBot(token, { repo, appUrl: process.env.APP_URL ?? 'http://localhost:3000' });
    cached = webhookCallback(bot, 'http', { secretToken: secret });
  }
  return cached(req, res);
}
