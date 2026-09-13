// Р147/Р149: окрема Vercel-функція для вебхука Telegram (api/telegram.ts → api-dist/telegram.mjs).
// Секрет вебхука — заголовок X-Telegram-Bot-Api-Secret-Token (той самий рядок, що в
// setWebhook secret_token). Довгий хід (модель): 200 віддаємо ОДРАЗУ, обробка — через
// waitUntil з @vercel/functions у межах maxDuration (vercel.json: 120 с); Telegram
// інакше повторював би апдейт через ~60 с. Без токена або секрету — 503.
import './env.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { waitUntil } from '@vercel/functions';
import type { Bot } from 'grammy';
import { pickRepo, pickStore } from './server.js';
import { makeTelegramBot } from './telegram-bot.js';

let botPromise: Promise<Bot> | null = null;
async function getBot(token: string): Promise<Bot> {
  if (!botPromise) {
    botPromise = (async () => {
      const repo = await pickRepo();
      const bot = makeTelegramBot(token, { repo, store: pickStore(), appUrl: process.env.APP_URL ?? 'http://localhost:3000' });
      await bot.init();
      return bot;
    })();
  }
  return botPromise;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":"telegram_not_configured"}'); }
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
  if (req.headers['x-telegram-bot-api-secret-token'] !== secret) { res.writeHead(401); return res.end(); }
  let update: unknown;
  try { update = JSON.parse(await readBody(req)); } catch { res.writeHead(400); return res.end(); }
  const bot = await getBot(token);
  // 200 одразу; сам хід доживає через waitUntil.
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{"ok":true}');
  waitUntil(bot.handleUpdate(update as Parameters<Bot['handleUpdate']>[0]).catch((err: unknown) => { console.error('telegram-webhook', String(err)); }));
}
