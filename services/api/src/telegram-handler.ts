// Р147/Р149: окрема Vercel-функція для вебхука Telegram (api/telegram.ts → api-dist/telegram.mjs).
// Секрет вебхука — заголовок X-Telegram-Bot-Api-Secret-Token (той самий рядок, що в
// setWebhook secret_token). Без токена або секрету — 503.
//
// Хотфікс 13.09 (#99): тіло на Vercel уже прочитане рантаймом у req.body — потік
// завершений, `end` не настане; тіло беремо з req.body, з потоку — лише живого.
// Хотфікс 13.09 №3: getMe з лямбди висів (init timeout) — botInfo без getMe, запити до
// Telegram лише по IPv4 через undici (telegram-bot.ts); діагностику егресу знято
// після підтвердження на проді (14.09).
// Хотфікс 13.09 №2: після 200 фон через waitUntil на проді не виконувався (лог
// обривався на «secret ok»). Тому хід — ДО відповіді: await init + handleUpdate
// (включно з sendMessage), потім 200; maxDuration 120 с (vercel.json). Telegram на
// довгий хід сам не зʼїде: після свого таймауту він повторить той самий update_id,
// а його ми вже ігноруємо — TTL-кеш ставиться в handleTelegramText ПЕРШИМ рядком,
// до будь-якої обробки. Помилка ходу — теж 200 (щоб Telegram не повторював), у лог.
import './env.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
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
      // botInfo задано з токена й username — init не ходить у мережу; без username
      // (нема TELEGRAM_BOT_USERNAME) лишається getMe з таймаутом.
      if (!bot.isInited()) await withTimeout(bot.init(), INIT_TIMEOUT_MS, 'bot.init (getMe)');
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
  try {
    console.log('telegram-webhook: init…');
    const bot = await getBot(token);
    console.log('telegram-webhook: init ok', `${Date.now() - t0}ms`, '→ handleUpdate', update.update_id);
    // handleUpdate чекає весь ланцюжок: хід чату і ctx.reply (sendMessage).
    await bot.handleUpdate(update as Parameters<Bot['handleUpdate']>[0]);
    console.log('telegram-webhook: done', update.update_id, `${Date.now() - t0}ms`);
  } catch (err) {
    console.error('telegram-webhook: failed', update.update_id, `${Date.now() - t0}ms`, String(err));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{"ok":true}');
}
