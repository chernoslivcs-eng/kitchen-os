// Vercel Serverless entrypoint — тонкий шар над пребандленим сервером.
//
// Чому не прямий import: воркспейс-пакети @kitchen/* — це TypeScript-сирці
// (main: ./index.ts), і Vercel-збирач не пакує їх у лямбду — cold start падав
// з ERR_MODULE_NOT_FOUND. Тому build-крок (scripts/build-vercel у корені)
// esbuild'ом збирає services/api/src/vercel-handler.ts в один самодостатній
// api-dist/server.mjs, а сюди він потрапляє через includeFiles + динамічний
// import (нестатичний шлях — щоб збирач не намагався трейсити його сам).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<unknown>;
let cached: Handler | null = null;

export default async function entry(req: IncomingMessage, res: ServerResponse) {
  if (!cached) {
    const bundlePath = join(process.cwd(), 'api-dist/server.mjs');
    const mod = await import(/* @vite-ignore */ pathToFileURL(bundlePath).href);
    cached = mod.default as Handler;
  }
  return cached(req, res);
}
