// Р147/Р149: окрема Vercel-функція для вебхука Telegram (api/telegram.ts → api-dist/telegram.mjs).
// Секрет вебхука — заголовок X-Telegram-Bot-Api-Secret-Token (той самий рядок, що в
// setWebhook secret_token). Без токена або секрету — 503.
//
// Хотфікс 13.09 (прод висів, «Read timeout expired»): на Vercel рантайм ЧИТАЄ тіло
// запиту сам і кладе його в req.body — потік уже завершений, і `req.on('end')` не
// настане ніколи; функція мовчала до першого логу. Тепер тіло беремо з req.body,
// коли воно є, зі свого потоку — лише коли той ще живий, і з таймаутом. 200 іде
// одразу після секрету й тіла — ДО init бота і будь-якої мережі; init (getMe) і
// сам хід — через waitUntil з @vercel/functions у межах maxDuration (120 с),
// init — з таймаутом 5 с, кожен крок — у логи функції.
import './env.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { waitUntil } from '@vercel/functions';
import type { Bot } from 'grammy';
import { pickRepo, pickStore } from './server.js';
import { makeTelegramBot } from './telegram-bot.js';

export const INIT_TIMEOUT_MS = 5_000;
export const BODY_TIMEOUT_MS = 3_000;

let botPromise: Promise<Bot> | null = null;
async function getBot(token: string): Promise<Bot> {
  if (!botPromise) {
    botPromise = (async () => {
      const repo = await pickRepo();
      const bot = makeTelegramBot(token, { repo, store: pickStore(), appUrl: process.env.APP_URL ?? 'http://localhost:3000' });
      await withTimeout(bot.init(), INIT_TIMEOUT_MS, 'bot.init (getMe)');
      return bot;
    })().catch((err: unknown) => { botPromise = null; throw err; });   // невдалий init не залипає на весь теплий контейнер
  }
  return botPromise;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what}: timeout ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e); });
  });
}

/** Тіло: req.body від рантайму Vercel (обʼєкт або рядок) → свій потік, якщо ще живий → ''. */
export async function readWebhookBody(req: IncomingMessage & { body?: unknown }): Promise<{ raw: string; source: string }> {
  if (req.body !== undefined && req.body !== null) {
    return { raw: typeof req.body === 'string' ? req.body : JSON.stringify(req.body), source: 'req.body' };
  }
  if (req.readableEnded || req.complete) return { raw: '', source: 'ended' };
  const raw = await withTimeout(new Promise<string>((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  }), BODY_TIMEOUT_MS, 'read body');
  return { raw, source: 'stream' };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":"telegram_not_configured"}'); }
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
  if (req.headers['x-telegram-bot-api-secret-token'] !== secret) { res.writeHead(401); return res.end(); }
  const t0 = Date.now();
  let update: { update_id?: number };
  let source = '';
  try {
    const body = await readWebhookBody(req);
    source = body.source;
    update = JSON.parse(body.raw || 'null') as { update_id?: number };
    if (!update || typeof update !== 'object') throw new Error('empty');
  } catch (err) {
    console.log('telegram-webhook: bad body', source, String(err));
    res.writeHead(400); return res.end();
  }
  console.log('telegram-webhook: secret ok, body from', source, 'update_id', update.update_id);
  // 200 одразу — до init бота й будь-якої мережі; Telegram інакше повторює апдейт.
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{"ok":true}');
  waitUntil((async () => {
    try {
      console.log('telegram-webhook: init…');
      const bot = await getBot(token);
      console.log('telegram-webhook: init ok', `${Date.now() - t0}ms`, '→ handleUpdate', update.update_id);
      await bot.handleUpdate(update as Parameters<Bot['handleUpdate']>[0]);
      console.log('telegram-webhook: done', update.update_id, `${Date.now() - t0}ms`);
    } catch (err) {
      console.error('telegram-webhook: failed', update.update_id, String(err));
    }
  })());
}
