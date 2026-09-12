#!/usr/bin/env node
// Пара «канон v3.1 (spec) · актуальний (Prototype 12.09)» з ОДНОГО сервера:
// ліва половина — з localStorage kos-glass=canon (72/78 %, blur 18, без
// зайомлення й грейну), права — як є. Власнику для вибору.
//
//   node scripts/glass-compare.mjs --url http://localhost:5192 --path /app --width 1440 --theme light \
//        --stub-messages docs/…/stub-recipe-glass.json --out out/glass/glass-canon-vs-actual-1440-light.png
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const URL_BASE = arg('url', 'http://localhost:5192').replace(/\/$/, '');
const PATH = arg('path', '/app');
const WIDTH = Number(arg('width', 1440));
const HEIGHT = Number(arg('height', WIDTH <= 480 ? 844 : 900));
const THEME = arg('theme', 'light');
const OUT = arg('out', `out/glass-canon-vs-actual-${WIDTH}-${THEME}.png`);
const STUB = arg('stub-messages', null);
const CLICK = arg('click', null);
const STATE = arg('state', `out/.ba-state-${new URL(URL_BASE).port}.json`);
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(URL_BASE).hostname)) { console.error('glass-compare: лише локальний сервер'); process.exit(2); }
if (!existsSync(STATE)) { console.error(`glass-compare: нема стану сесії ${STATE} — спершу before-after.mjs на цьому порту`); process.exit(1); }

const browser = await chromium.launch();
async function shot(canon) {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2, storageState: STATE, ...(WIDTH < 768 ? { isMobile: true, hasTouch: true } : {}) });
  if (canon) await ctx.addInitScript(() => localStorage.setItem('kos-glass', 'canon'));
  const page = await ctx.newPage();
  await page.emulateMedia({ colorScheme: THEME });
  if (STUB) {
    const extra = JSON.parse(readFileSync(STUB, 'utf8'));
    await page.route(/\/v1\/(session\/today|sessions\/[^/?]+)(\?.*)?$/, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const res = await route.fetch(); const body = await res.json(); const base = Date.now();
      body.messages = [...(body.messages ?? []), ...extra.map((m, i) => ({ id: `stub-${i}`, session_id: body.session?.id ?? '', role: 'assistant', text: null, card: null, applied: 0, created_at: new Date(base + 60_000 * (i + 1)).toISOString(), ...m }))];
      await route.fulfill({ response: res, json: body });
    });
  }
  await page.goto(`${URL_BASE}${PATH}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  if (CLICK) { await page.click(CLICK); await page.waitForTimeout(800); }
  const png = await page.screenshot({ type: 'png' });
  await ctx.close();
  return png;
}
const a = await shot(true), b = await shot(false);
const b64 = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#c9ccd0;font:13px/1.4 system-ui;color:#1a1c1e}.wrap{display:flex;gap:24px;padding:20px}.col{display:flex;flex-direction:column;gap:8px}.cap{font-weight:600}.cap span{font-weight:400;color:#6b6f74}img{display:block;box-shadow:0 8px 24px rgba(0,0,0,.15)}</style>
<div class="wrap"><div class="col"><div class="cap">Канон v3.1 (spec) <span>72/78 % · blur 18 · sat 1.25 · без зайомлення й грейну</span></div><img src="${b64(a)}" width="${WIDTH}"></div>
<div class="col"><div class="cap">Актуальний (Prototype 12.09) <span>46/56 % · blur 30 · sat 1.8 · brightness 1.04 · зайомлення · грейн</span></div><img src="${b64(b)}" width="${WIDTH}"></div></div>`;
const outCtx = await browser.newContext({ viewport: { width: WIDTH * 2 + 64, height: HEIGHT + 60 }, deviceScaleFactor: 1 });
const outPage = await outCtx.newPage(); await outPage.setContent(html); await outPage.waitForTimeout(300);
mkdirSync(dirname(resolve(OUT)), { recursive: true });
writeFileSync(resolve(OUT), await outPage.screenshot({ type: 'png', fullPage: true }));
console.log(`glass-compare → ${OUT} · ${PATH} · ${WIDTH}×${HEIGHT} · ${THEME}`);
await browser.close();
