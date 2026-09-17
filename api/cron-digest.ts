// Vercel Cron entrypoint для ранкового дайджесту (DIGEST-PLAN-0917) — тонкий
// шар над пребандленим api-dist/cron-digest.mjs (та сама причина, що
// api/telegram.ts: воркспейс-пакети збирач Vercel у лямбду не пакує).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<unknown>;
let cached: Handler | null = null;

export default async function entry(req: IncomingMessage, res: ServerResponse) {
  if (!cached) {
    const bundlePath = join(process.cwd(), 'api-dist/cron-digest.mjs');
    const mod = await import(/* @vite-ignore */ pathToFileURL(bundlePath).href);
    cached = mod.default as Handler;
  }
  return cached(req, res);
}
