// П.2 pre-deploy: локальний Vercel-емулятор для прод-збірки. Ті самі
// rewrites, що у vercel.json: /v1|/health|/r/:id → api/index.ts handler;
// /assets, sw.js, manifest, icon → статика з dist; решта → index.html (SPA).
// Це прод-бандл без StrictMode і з живим service worker — середовище,
// в якому жив таймер-баг QA8-03.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });
process.chdir(resolve(import.meta.dirname, '../../..'));
// Моушн-пас: хендлер тепер пребандлений (api-dist/server.mjs), і відносний
// шлях лог-файлу магік-лінків у mailer.ts їде від import.meta.url бандла.
// Явний env повертає лог у корінь репо — auth.setup e2e читає саме його.
process.env.MAGIC_LINK_LOG ??= resolve('.qa-magic-links.log');

const { default: handler } = await import('../../../api/index.js');
const DIST = resolve('apps/web/dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0]!;
  if (url.startsWith('/v1/') || url === '/health' || /^\/r\/[a-f0-9-]{36}/i.test(url)) {
    return void handler(req, res);
  }
  const staticPath = url === '/' ? null : join(DIST, url);
  if (staticPath && (url.startsWith('/assets/') || ['/sw.js', '/manifest.webmanifest', '/icon.svg'].includes(url))) {
    try {
      const body = await readFile(staticPath);
      res.writeHead(200, { 'Content-Type': MIME[extname(staticPath)] ?? 'application/octet-stream' });
      return res.end(body);
    } catch { res.writeHead(404); return res.end(); }
  }
  const html = await readFile(join(DIST, 'index.html'));
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
server.listen(4173, () => console.log('prod-serve on http://localhost:4173'));
