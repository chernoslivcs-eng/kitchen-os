// Vercel Serverless entrypoint для Telegram-вебхука (Р147) — тонкий шар над
// пребандленим api-dist/telegram.mjs, з тієї самої причини, що й api/index.ts:
// воркспейс-пакети @kitchen/* — TypeScript-сирці, збирач Vercel їх у лямбду не
// пакує; esbuild (build:vercel-fn) збирає services/api/src/telegram-handler.ts
// в один файл, сюди він потрапляє через includeFiles + динамічний import.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<unknown>;
let cached: Handler | null = null;

export default async function entry(req: IncomingMessage, res: ServerResponse) {
  if (!cached) {
    const bundlePath = join(process.cwd(), 'api-dist/telegram.mjs');
    const mod = await import(/* @vite-ignore */ pathToFileURL(bundlePath).href);
    cached = mod.default as Handler;
  }
  return cached(req, res);
}
