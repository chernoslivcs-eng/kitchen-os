#!/usr/bin/env node
// Здача Icon Motion v2 (Р117): для кожного з 16 знаків — запис руху в
// застосунку (/dev/icons, лише dev-збірка: кнопка рейки 18 і плитка 20) і
// кадр ПОРУЧ із файлом власника (ai/project/Kitchen OS - Icon Motion.dc.html):
// той самий знак у data-play, анімації обох сторін зупинені на 45 % своєї
// тривалості (document.getAnimations → pause), щоб порівняти саме фазу руху.
// Файл — світлий (кольори в ньому літерали), застосунок — світла й темна.
//
//   node scripts/icon-motion-lab.mjs --url http://localhost:5196 --out docs/…/icon-motion-v2
//
// Лише локальний хост; входу не треба (/dev/icons поза каркасом).
import { chromium } from '@playwright/test';
import { mkdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const URL_BASE = (arg('url', 'http://localhost:5196')).replace(/\/$/, '');
const OUT = arg('out', 'docs/superpowers/plans/side-by-side/icon-motion-v2');
const PHASE = Number(arg('phase', 0.45));
const host = new URL(URL_BASE).hostname;
if (!(host === 'localhost' || host === '127.0.0.1')) { console.error(`icon-motion-lab: відмова — ${host} не локальний.`); process.exit(2); }
mkdirSync(resolve(OUT), { recursive: true });

const KEYS = ['bubble', 'door', 'book', 'checks', 'flip', 'home', 'roll', 'unroll', 'turn', 'listen', 'lift', 'clip', 'orbit', 'sliders', 'swap', 'tick'];
const DUR = { bubble: 1050, door: 1050, book: 1150, checks: 1000, flip: 900, home: 980, roll: 1050, unroll: 850, turn: 620, listen: 1300, lift: 880, clip: 1050, orbit: 1150, sliders: 1250, swap: 1050, tick: 750 };
const dcPath = resolve('ai/project/Kitchen OS - Icon Motion.dc.html');

const browser = await chromium.launch();

// Зупинити всі анімації в межах елемента на частці їхньої тривалості.
const pauseAt = async (page, sel, frac) => page.evaluate(([sel, frac]) => {
  const root = document.querySelector(sel); if (!root) return 0;
  let n = 0;
  for (const a of document.getAnimations()) {
    const t = a.effect?.target; if (!t || !root.contains(t)) continue;
    const timing = a.effect.getComputedTiming();
    const total = Number(timing.delay) + Number(timing.duration);
    a.currentTime = total * frac; a.pause(); n++;
  }
  return n;
}, [sel, frac]);

// ── 1. Кадри: файл (light) · застосунок light (рейка, плитка) · dark (рейка, плитка) ──
const shots = {};
{
  const dc = await browser.newContext({ viewport: { width: 1300, height: 1400 }, deviceScaleFactor: 4 });
  const dcPage = await dc.newPage();
  await dcPage.goto(pathToFileURL(dcPath).href, { waitUntil: 'networkidle' }).catch(() => {});
  await dcPage.waitForTimeout(1200);
  for (const k of KEYS) {
    const sel = `[data-iconlab] > div:nth-of-type(2) [data-motion="${k}"]`;
    await dcPage.evaluate((sel) => { const el = document.querySelector(sel); el.dataset.play = '1'; }, sel);
    await dcPage.waitForTimeout(30);
    const n = await pauseAt(dcPage, sel, PHASE);
    const tile = dcPage.locator(`${sel} > span:first-child`);
    shots[`${k}:file`] = await tile.screenshot({ type: 'png' });
    await dcPage.evaluate((sel) => { delete document.querySelector(sel).dataset.play; }, sel);
    if (!n) console.warn(`file: ${k} — анімацій 0`);
  }
  await dc.close();
}
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 700 }, deviceScaleFactor: 4, colorScheme: theme });
  const page = await ctx.newPage();
  await page.goto(`${URL_BASE}/dev/icons`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-icon-lab]');
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await page.waitForTimeout(500);
  for (const k of KEYS) for (const kind of ['rail', 'tile']) {
    const sel = `[data-lab="${kind}:${k}"]`;
    await page.evaluate((sel) => { document.querySelector(sel).dispatchEvent(new Event('pointerenter')); }, sel);
    await page.waitForTimeout(30);
    const n = await pauseAt(page, sel, PHASE);
    shots[`${k}:${kind}:${theme}`] = await page.locator(sel).screenshot({ type: 'png' });
    await page.evaluate((sel) => { delete document.querySelector(sel).dataset.play; for (const a of document.getAnimations()) a.cancel(); }, sel);
    await page.waitForTimeout(60);
    if (!n) console.warn(`app ${theme}: ${k}/${kind} — анімацій 0`);
  }
  await ctx.close();
}
// Склеїти: файл · рейка light · плитка light · рейка dark · плитка dark — одна картка на знак.
{
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 400 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const b64 = (b) => `data:image/png;base64,${Buffer.from(b).toString('base64')}`;
  for (const k of KEYS) {
    const cells = [['файл · light', shots[`${k}:file`]], ['рейка 18 · light', shots[`${k}:rail:light`]], ['плитка 20 · light', shots[`${k}:tile:light`]], ['рейка 18 · dark', shots[`${k}:rail:dark`]], ['плитка 20 · dark', shots[`${k}:tile:dark`]]];
    await page.setContent(`<body style="margin:0;background:#c9ccd0;font-family:Onest,system-ui,sans-serif"><div style="display:flex;gap:16px;padding:16px;align-items:flex-start">
      ${cells.map(([label, png]) => `<figure style="margin:0;display:flex;flex-direction:column;gap:6px;align-items:center"><img src="${b64(png)}" style="height:176px;image-rendering:auto;border-radius:12px"><figcaption style="font-size:12px;color:#1a1c1e">${label}</figcaption></figure>`).join('')}
      <div style="align-self:center;font-size:13px;color:#1a1c1e;margin-left:8px"><b>${k}</b> · ${DUR[k]} мс · кадр на ${Math.round(PHASE * 100)} %</div></div></body>`);
    const el = page.locator('body > div');
    await el.screenshot({ path: resolve(OUT, `frame-${k}.png`) });
  }
  await ctx.close();
}
console.log(`icon-motion-lab → кадри ${KEYS.length} × 5 у ${OUT}/frame-*.png`);

// ── 2. Записи: рейка й плитки, кожен знак по черзі, світла й темна ──
for (const theme of ['light', 'dark']) {
  const videoDir = resolve('out/.video-lab'); mkdirSync(videoDir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 520 }, deviceScaleFactor: 2, colorScheme: theme, recordVideo: { dir: videoDir, size: { width: 1200, height: 520 } } });
  const page = await ctx.newPage();
  await page.goto(`${URL_BASE}/dev/icons`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-icon-lab]');
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await page.waitForTimeout(600);
  for (const kind of ['rail', 'tile']) for (const k of KEYS) {
    await page.locator(`[data-lab="${kind}:${k}"]`).hover();
    await page.waitForTimeout(DUR[k] + 160);
  }
  // Натиск — .955 за 110 мс, і повтор після завершення.
  const b = page.locator('[data-lab="tile:tick"]'); await b.hover(); await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up(); await page.waitForTimeout(900);
  await ctx.close();
  const video = await page.video()?.path();
  if (video) renameSync(video, resolve(OUT, `icon-motion-v2-${theme}.webm`));
  console.log(`icon-motion-lab → ${OUT}/icon-motion-v2-${theme}.webm`);
}
await browser.close();
