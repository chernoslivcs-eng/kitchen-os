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
// підмінюємо HTML spa.html із заповненими OG-тегами (title, description).
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
    const body = await readSpaHtml();
    res.writeHead(inj.statusCode === 404 ? 404 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(body);
  }
  const data = inj.json() as { title?: string; recipe?: { d?: string; tm?: number; sv?: number } };
  const title = data.title ?? 'Рецепт';
  const descRaw = data.recipe?.d ?? '';
  const desc = (descRaw || `${data.recipe?.tm ?? ''} хв · ${data.recipe?.sv ?? ''} порції`).trim();
  const html = await readSpaHtml();
  const host = req.headers.host ?? '';
  const proto = (req.headers['x-forwarded-proto'] as string) ?? 'https';
  const canonical = `${proto}://${host}/r/${id}`;
  const injected = injectOgTags(html, { title, description: desc, url: canonical });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(injected);
}

let spaHtmlCache: string | null = null;
async function readSpaHtml(): Promise<string> {
  if (spaHtmlCache) return spaHtmlCache;
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  // Пошукова база, крок 3: файл перейменовано з index.html на spa.html —
  // Vercel інакше віддавав його напряму на збіг шляху, ДО rewrites (бот-UA
  // правило для «/» не встигало спрацювати). На Vercel фронтенд build
  // попадає в /var/task/apps/web/dist/spa.html; локально — те саме
  // відносно process.cwd().
  const path = join(process.cwd(), 'apps/web/dist/spa.html');
  spaHtmlCache = await readFile(path, 'utf-8');
  return spaHtmlCache;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Підміна ЗНАЧЕНЬ на місці, не вставка нового блоку: index.html (Крок 1
// пошукової бази, 03.10) уже несе статичні title/description/og:*/
// twitter:*/canonical лендінгу в head — попередня версія вставляла СВОЇ
// теги замість <title>, а статичні og:*/twitter:*/canonical/description
// лишались поруч незмінними → на /r/:id у проді виходило по двоє
// og:title/canonical й більше (Telegram/Facebook беруть ПЕРШИЙ, тож прев'ю
// рецепта показувало назву застосунку, не страви). Кожен тег — рівно один
// в index.html, тому заміна по регулярці, яка ловить САМЕ цей тег, безпечна:
// дублів не з'явиться, бо нічого не додається, лише правиться наявне.
// Рівно ДВІ групи в кожному tagPattern нижче (before, after) — третій
// параметр callback'а .replace() це offset (число), не третя група; зайвий
// параметр тут зсунув би after на offset і вставляв би число замість
// закривної дужки тега (живцем пійманий баг, перший прогін теста).
function replaceTagValue(html: string, tagPattern: RegExp, value: string): string {
  return html.replace(tagPattern, (_match, before: string, after: string) => `${before}${escape(value)}${after}`);
}

export function injectOgTags(html: string, meta: { title: string; description: string; url: string }): string {
  let out = html;
  out = replaceTagValue(out, /(<title>)[^<]*(<\/title>)/i, `${meta.title} · Kitchen OS`);
  out = replaceTagValue(out, /(<meta name="description" content=")[^"]*("\s*\/?>)/i, meta.description);
  out = replaceTagValue(out, /(<meta property="og:title" content=")[^"]*("\s*\/?>)/i, meta.title);
  out = replaceTagValue(out, /(<meta property="og:description" content=")[^"]*("\s*\/?>)/i, meta.description);
  out = replaceTagValue(out, /(<meta property="og:url" content=")[^"]*("\s*\/?>)/i, meta.url);
  out = replaceTagValue(out, /(<meta property="og:type" content=")[^"]*("\s*\/?>)/i, 'article');
  out = replaceTagValue(out, /(<meta name="twitter:card" content=")[^"]*("\s*\/?>)/i, 'summary');
  out = replaceTagValue(out, /(<meta name="twitter:title" content=")[^"]*("\s*\/?>)/i, meta.title);
  out = replaceTagValue(out, /(<meta name="twitter:description" content=")[^"]*("\s*\/?>)/i, meta.description);
  out = replaceTagValue(out, /(<link rel="canonical" href=")[^"]*(")/i, meta.url);
  return out;
}
