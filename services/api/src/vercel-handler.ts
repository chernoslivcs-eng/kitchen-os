// Vercel Serverless entrypoint для fastify.
// Vercel викликає default-експорт як (req, res) — той самий Node.js
// адаптер, з яким fastify працює через app.server.emit('request').
//
// Fastify інстанс — глобальний. Warm-container Vercel-функції переповторно
// живе між запитами, тому build робимо лише один раз на cold start (~800ms
// з pg + міграція). Наступні запити мають ~1-5ms overhead.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildAppWithBackend } from './server.js';

let cached: Awaited<ReturnType<typeof buildAppWithBackend>> | null = null;

async function getApp() {
  if (cached) return cached;
  cached = await buildAppWithBackend();
  await cached.ready();
  return cached;
}

// Один додатковий шар перед fastify — якщо URL починається з `/r/<uuid>`,
// підмінюємо HTML index.html із заповненими OG-тегами (title, description).
// Це потрібно, щоб прев'ю в Telegram/Twitter/Slack працювало. Решта проходить
// через fastify без змін.
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = req.url ?? '';
  const rMatch = url.match(/^\/r\/([a-f0-9-]{36})(?:\?|$)/i);
  if (rMatch && req.method === 'GET') {
    return handleRecipeShare(req, res, rMatch[1]!);
  }
  const app = await getApp();
  app.server.emit('request', req, res);
}

async function handleRecipeShare(req: IncomingMessage, res: ServerResponse, id: string) {
  const app = await getApp();
  const inj = await app.inject({ method: 'GET', url: `/v1/r/${id}` });
  if (inj.statusCode !== 200) {
    // 404 і т.п. — все одно повертаємо звичайний SPA, клієнтський роут відрендерить
    // "Рецепт не знайдено" екран.
    const body = await readIndexHtml();
    res.writeHead(inj.statusCode === 404 ? 404 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(body);
  }
  const data = inj.json() as { title?: string; recipe?: { d?: string; tm?: number; sv?: number } };
  const title = data.title ?? 'Рецепт';
  const descRaw = data.recipe?.d ?? '';
  const desc = (descRaw || `${data.recipe?.tm ?? ''} хв · ${data.recipe?.sv ?? ''} порції`).trim();
  const html = await readIndexHtml();
  const host = req.headers.host ?? '';
  const proto = (req.headers['x-forwarded-proto'] as string) ?? 'https';
  const canonical = `${proto}://${host}/r/${id}`;
  const injected = injectOgTags(html, { title, description: desc, url: canonical });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(injected);
}

let indexHtmlCache: string | null = null;
async function readIndexHtml(): Promise<string> {
  if (indexHtmlCache) return indexHtmlCache;
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  // На Vercel фронтенд build попадає в /var/task/apps/web/dist/index.html;
  // локально — apps/web/dist/index.html відносно process.cwd().
  const path = join(process.cwd(), 'apps/web/dist/index.html');
  indexHtmlCache = await readFile(path, 'utf-8');
  return indexHtmlCache;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function injectOgTags(html: string, meta: { title: string; description: string; url: string }): string {
  const tags = [
    `<title>${escape(meta.title)} · Kitchen OS</title>`,
    `<meta property="og:title" content="${escape(meta.title)}" />`,
    `<meta property="og:description" content="${escape(meta.description)}" />`,
    `<meta property="og:url" content="${escape(meta.url)}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="Kitchen OS" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escape(meta.title)}" />`,
    `<meta name="twitter:description" content="${escape(meta.description)}" />`,
  ].join('\n    ');
  // Замінюємо існуючий <title>Kitchen OS</title>; якщо не знайдено —
  // вставляємо перед </head>.
  if (/<title>[^<]*<\/title>/i.test(html)) {
    return html.replace(/<title>[^<]*<\/title>/i, tags);
  }
  return html.replace(/<\/head>/i, `    ${tags}\n  </head>`);
}
