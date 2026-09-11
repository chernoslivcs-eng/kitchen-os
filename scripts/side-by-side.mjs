#!/usr/bin/env node
// Поруч-порівняння: кадр бандла проти рендеру застосунку, в ширині кадра.
// Правило здачі з 11.09: етап, що торкається екрана, здається з такою парою
// на кожну ширину бандла (1440 · 390 · 768 · 1920, де Screens її дає).
// Тести й пороги лишаються — але вони більше не достатні.
//
//   node scripts/side-by-side.mjs --dc Screens --frame "Комора · збірка" \
//        --url http://localhost:5173/pantry --width 1440 \
//        --email dev@local.test --log .qa-magic-links.log --out out/pantry-1440.png
//
// --dc      файл бандла без префікса й розширення (Screens · Responsive · Components …)
// --frame   підрядок data-screen-label; --nth N — який зі збігів (0)
// --sel     замість --frame: довільний селектор у бандлі
// --theme   light | dark (типово light) — і бандл (data-theme), і застосунок (emulateMedia)
// --list    лише перелічити data-screen-label у файлі й вийти
//
// Бандл читається з file:// і потребує мережі для шрифту Onest і lucide з
// unpkg — так само, як його дивиться дизайн-чат. Застосунок — лише локальний
// або засів (той самий запобіжник, що в design-audit).

import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(`--${k}`);

const DC = arg('dc', 'Screens');
const FRAME = arg('frame', null);
const SEL = arg('sel', null);
const NTH = Number(arg('nth', 0));
const URL_BASE = (arg('url', '') || '').replace(/\/$/, '');
const WIDTH = Number(arg('width', 1440));
const HEIGHT = Number(arg('height', WIDTH <= 480 ? 844 : 900));
const THEME = arg('theme', 'light');
const OUT = arg('out', `out/side-by-side-${WIDTH}.png`);
const EMAIL = arg('email', null);
const LOG = arg('log', '.qa-magic-links.log');
const STATE = arg('state', null);

const dcPath = resolve(`ai/project/Kitchen OS - ${DC}.dc.html`);

if (URL_BASE) {
  const host = new URL(URL_BASE).hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  if (!local) { console.error(`side-by-side: відмова — ${host} не локальний. Порівняння знімається лише з засіву.`); process.exit(2); }
}

const browser = await chromium.launch();

// ── кадр бандла ────────────────────────────────────────────────────────────
const dcCtx = await browser.newContext({ viewport: { width: 2400, height: 1600 }, deviceScaleFactor: 2 });
const dcPage = await dcCtx.newPage();
await dcPage.goto(pathToFileURL(dcPath).href, { waitUntil: 'networkidle' }).catch(() => {});
await dcPage.waitForTimeout(800);
if (has('list')) {
  const labels = await dcPage.$$eval('[data-screen-label]', (els) => els.map((e) => e.getAttribute('data-screen-label')));
  console.log(labels.join('\n'));
  await browser.close();
  process.exit(0);
}
if (THEME === 'dark') await dcPage.$$eval('.v3', (els) => els.forEach((e) => e.setAttribute('data-theme', 'dark')));
const frameSel = SEL ?? `[data-screen-label*="${FRAME}"]`;
const frames = await dcPage.$$(frameSel);
if (!frames[NTH]) { console.error(`side-by-side: кадр не знайдено — ${frameSel} [${NTH}] у ${DC}`); await browser.close(); process.exit(1); }
const frame = frames[NTH];
await frame.scrollIntoViewIfNeeded();
const frameLabel = (await frame.getAttribute('data-screen-label')) ?? SEL;
const frameBox = await frame.boundingBox();
const framePng = await frame.screenshot({ type: 'png' });

// ── рендер застосунку ──────────────────────────────────────────────────────
let appPng = null; let appNote = 'застосунок не знімався (--url не задано)';
if (URL_BASE) {
  const appCtx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2,
    ...(STATE ? { storageState: STATE } : {}),
    ...(WIDTH < 768 ? { isMobile: true, hasTouch: true } : {}),
  });
  const page = await appCtx.newPage();
  await page.emulateMedia({ colorScheme: THEME });
  await page.goto(`${URL_BASE}/`, { waitUntil: 'domcontentloaded' });
  if (EMAIL && !STATE) {
    // Той самий вхід, що в design-audit: magic link із локального логу.
    await page.request.post(`${URL_BASE}/v1/auth/request`, { data: { email: EMAIL } });
    await page.waitForTimeout(600);
    const line = readFileSync(LOG, 'utf8').trim().split('\n').at(-1) ?? '';
    const link = line.match(/https?:\S*token=\S+/)?.[0];
    if (!link) { console.error('side-by-side: magic link не знайдено в логу'); await browser.close(); process.exit(1); }
    await page.goto(link.replace(/^https?:\/\/[^/]+/, URL_BASE), { waitUntil: 'domcontentloaded' });
  }
  await page.goto(`${URL_BASE}${arg('path', new URL(URL_BASE).pathname === '/' ? '' : '')}`, { waitUntil: 'domcontentloaded' });
  const path = arg('path', null);
  if (path) await page.goto(`${URL_BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  appPng = await page.screenshot({ type: 'png', fullPage: false });
  appNote = `${URL_BASE}${path ?? ''} · ${WIDTH}×${HEIGHT} · ${THEME}`;
}

// ── склейка ────────────────────────────────────────────────────────────────
const b64 = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const html = `<!doctype html><meta charset="utf-8">
<style>
  body{margin:0;background:#c9ccd0;font:13px/1.4 system-ui;color:#1a1c1e}
  .wrap{display:flex;gap:24px;padding:20px;align-items:flex-start}
  .col{display:flex;flex-direction:column;gap:8px}
  .cap{font-weight:600}.cap span{font-weight:400;color:#6b6f74}
  img{display:block;box-shadow:0 8px 24px rgba(0,0,0,.15);background:#fff}
</style>
<div class="wrap">
  <div class="col"><div class="cap">Бандл · ${DC} <span>${frameLabel} · ${Math.round(frameBox.width)}×${Math.round(frameBox.height)}</span></div><img src="${b64(framePng)}" width="${Math.round(frameBox.width)}"></div>
  <div class="col"><div class="cap">Рендер <span>${appNote}</span></div>${appPng ? `<img src="${b64(appPng)}" width="${WIDTH}">` : ''}</div>
</div>`;
const outCtx = await browser.newContext({ viewport: { width: Math.round(frameBox.width) + WIDTH + 100, height: Math.max(Math.round(frameBox.height), HEIGHT) + 80 }, deviceScaleFactor: 1 });
const outPage = await outCtx.newPage();
await outPage.setContent(html);
await outPage.waitForTimeout(300);
mkdirSync(dirname(resolve(OUT)), { recursive: true });
writeFileSync(resolve(OUT), await outPage.screenshot({ type: 'png', fullPage: true }));
console.log(`side-by-side → ${OUT} · бандл «${frameLabel}» ${Math.round(frameBox.width)}×${Math.round(frameBox.height)} · рендер ${WIDTH}×${HEIGHT}`);
await browser.close();
