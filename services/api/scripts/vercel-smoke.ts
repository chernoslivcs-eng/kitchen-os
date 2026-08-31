// П.3 pre-deploy: api/index.ts (Vercel entry) ніколи не виконувався.
// Піднімаємо handler рівно так, як його кличе Vercel — node:http сервером —
// і ганяємо смоук: health, API-роут, SPA-фолбек OG, injection в OG-теги.

import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });
process.chdir(resolve(import.meta.dirname, '../../..'));   // readIndexHtml чекає cwd=корінь

const { default: handler } = await import('../../../api/index.js');

const server = createServer((req, res) => { void handler(req, res); });
await new Promise<void>((r) => server.listen(3777, r));
const base = 'http://localhost:3777';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

// 1. health через entry
const health = await fetch(`${base}/health`);
check('GET /health через entry', health.ok, `status=${health.status}`);

// 2. API-роут: неавтентифікований /v1/me → 401 (fastify живий за emit('request'))
const me = await fetch(`${base}/v1/me`);
check('GET /v1/me → 401 без кукі', me.status === 401, `status=${me.status}`);

// 3. /r/<неіснуючий uuid> → 404 + SPA html
const miss = await fetch(`${base}/r/00000000-0000-0000-0000-000000000000`);
const missHtml = await miss.text();
check('/r/<нема> → 404 зі SPA-фолбеком', miss.status === 404 && missHtml.includes('<div id="root">'), `status=${miss.status}`);

// 4. injection: рецепт зі шкідливою назвою → OG-теги екрановані
const { PostgresRepo, makePool } = await import('@kitchen/db');
const pool = makePool(process.env.PG_URL!);
const repo = new PostgresRepo(pool);
const { randomUUID } = await import('node:crypto');
const rid = randomUUID();
const evil = `"><script>alert('xss')</script><meta x="`;
const { rows: [owner] } = await pool.query(`SELECT id FROM "user" LIMIT 1`);
await repo.saveRecipe({
  id: rid, owner_id: owner.id, origin: 'generated', title: evil,
  requested_title: null, descr: `опис <img src=x onerror=alert(2)>`, character: null, risk: null,
  base_servings: 2, time_total: 10, nutrition: null,
  payload: { t: evil, sv: 2, tm: 10, ch: '', d: 'опис', rk: '', ing: [], st: [] },
  created_at: new Date().toISOString(), saved_at: new Date().toISOString(),
});
const share = await fetch(`${base}/r/${rid}`);
const shareHtml = await share.text();
const rawScript = shareHtml.includes(`<script>alert('xss')`);
const escaped = shareHtml.includes('&lt;script&gt;') || shareHtml.includes('&quot;&gt;');
check('OG-injection: <script> НЕ протік сирим', share.ok && !rawScript && escaped,
  rawScript ? 'RAW SCRIPT У ВІДПОВІДІ!' : `escaped=${escaped}`);
const ogTitle = /property="og:title" content="([^"]*)"/.exec(shareHtml)?.[1] ?? '';
check('og:title присутній і екранований', ogTitle.includes('&lt;script&gt;') || !ogTitle.includes('<'), ogTitle.slice(0, 60));

// прибираємо отруйний рецепт
await pool.query('DELETE FROM recipe WHERE id = $1', [rid]);
await pool.end();
server.close();
console.log(failures ? `\nFAILURES: ${failures}` : '\nOK');
process.exit(failures ? 1 : 0);
