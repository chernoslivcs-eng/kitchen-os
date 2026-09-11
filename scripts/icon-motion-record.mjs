#!/usr/bin/env node
// Етап 1.5b — запис екрана 10–15 с: рух знаків не влазить у кадр, тому
// здача — відео. Ховер по рейці зверху вниз, натиск, flame у шапці при
// позиціях ≤ 3 дні, timer під час готування, ховер по композитору.
// Лише локальний хост і засів; дані стану — мережевий стаб (/v1/pantry) і
// localStorage (kos-cook-live), база не чіпається.
//
//   node scripts/icon-motion-record.mjs --url http://localhost:5173 --theme dark --out docs/…/icon-motion-dark.webm
import { chromium } from '@playwright/test';
import { existsSync, renameSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const URL_BASE = (arg('url', 'http://localhost:5173')).replace(/\/$/, '');
const THEME = arg('theme', 'light');
const OUT = arg('out', `out/icon-motion-${THEME}.webm`);
const STATE = arg('state', 'out/.sbs-state.json');
const host = new URL(URL_BASE).hostname;
if (!(host === 'localhost' || host === '127.0.0.1')) { console.error(`icon-motion-record: відмова — ${host} не локальний.`); process.exit(2); }
if (!existsSync(STATE)) { console.error('icon-motion-record: нема стану входу (out/.sbs-state.json) — зніми спершу будь-яку пару side-by-side з --email.'); process.exit(1); }

const videoDir = resolve('out/.video');
mkdirSync(videoDir, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, storageState: STATE,
  recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  colorScheme: THEME,
});
const now = Date.now();
await ctx.addInitScript((cook) => { localStorage.setItem('kos-cook-live', cook); localStorage.setItem('kos-rail-hidden', '1'); localStorage.setItem('kos-nav-expanded', '0'); }, JSON.stringify({
  recipe: { t: 'Паста з помідорами й фуетом', sv: 2, ing: [], st: [{ t: 'Розігріти.' }, { t: 'Пекти.' }, { t: 'Паста.' }, { t: 'Зібрати.' }] },
  stepIdx: 2, secondsLeft: 402, deadline: now + 402_000, savedAt: now,
}));
const page = await ctx.newPage();
// Стаб комори: одна прострочена партія з ключем каталогу — flame у шапці дихає.
await page.route(/\/v1\/pantry(\?.*)?$/, async (route) => {
  if (route.request().method() !== 'GET') return route.continue();
  const res = await route.fetch(); const body = await res.json();
  body.batches = [...(body.batches ?? []), { id: 'stub-overdue', household_id: '', catalog_key: 'tomato', label: 'помідори (стаб)', zone: 'fresh', value: 400, unit: 'g', state: 'opened', opened_at: null, expires_at: null, best_before_opened_days: null, added_at: new Date().toISOString(), days: -2 }];
  body.count = (body.count ?? 0) + 1;
  await route.fulfill({ response: res, json: body });
});
await page.goto(`${URL_BASE}/app`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);

const hover = async (sel, ms = 950) => { const el = page.locator(sel).first(); if (await el.count()) { await el.hover(); await page.waitForTimeout(ms); } };
// 1. Рейка зверху вниз: чат · комора · рецепти · список · календар.
for (const sel of ['[data-nav-scroll] button[title="Стрічка"]', '[data-nav-scroll] button[title="Комора"]', '[data-nav-scroll] button[title="Рецепти"]', '[data-nav-scroll] button[title="Список"]', '[data-nav-scroll] button[title="Календар"]']) await hover(sel);
// 2. Натиск — scale .96, 160 мс (на активній цілі: клік не веде з екрана).
const chat = page.locator('[data-nav-scroll] button[title="Стрічка"]').first();
await chat.hover(); await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up(); await page.waitForTimeout(500);
// 3. Шапка: flame (живий), timer (живий), «Дім зараз» (home), пілюля.
await hover('[data-chip-overdue]', 1700); await hover('[data-chip-cooking]', 1300); await hover('[data-chip-home]'); await hover('[data-session-pill]', 700);
// 4. Композитор: «+» (turn), мікрофон (listen), надіслати (lift).
await hover('[data-attach-plus]'); await hover('[data-mic]'); await hover('[data-send]');
await page.waitForTimeout(600);

await ctx.close();
const video = await page.video()?.path();
mkdirSync(dirname(resolve(OUT)), { recursive: true });
if (video) renameSync(video, resolve(OUT));
await browser.close();
console.log(`icon-motion-record → ${OUT} · ${THEME}`);
