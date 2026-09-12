#!/usr/bin/env node
// Мобільна перевірка скролу й нижніх дій (fix/ios-inner-scroll-offset, 13.09).
// Висоти Safari на iPhone: 664 (тулбар видно) · 750 (тулбар схований) · 844
// (PWA з домашнього екрана — висота екрана). На кожному екрані каркаса:
//   · після mount — scrollY документа 0, scrollTop скролера 0, перший чіп під шапкою видно;
//   · перехід 664 → 750 → 664 після mount — те саме, scrollTop не змінюється, бар на місці;
//   · головна дія екрана (композитор, «Далі», «Готуємо», «Додати…») — над нижніми 80 px.
//
//   node scripts/mobile-scroll-check.mjs --url http://localhost:5192 [--engine webkit|chromium]
//        [--out out/mobile-check] [--email dev@local.test] [--log .qa-magic-links.log]
//
// Лише localhost. Сесія кешується в out/.mc-state-<port>.json (магік-лінк
// має ліміт). У mobile WebKit нема wheel — контекст без isMobile, але з
// hasTouch і UA iPhone: розкладка та сама, жест — колесом.
import { chromium, webkit, devices } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const URL_ = (arg('url', 'http://localhost:5192')).replace(/\/$/, '');
if (!['localhost', '127.0.0.1'].includes(new URL(URL_).hostname)) { console.error('mobile-scroll-check: лише localhost'); process.exit(1); }
const ENGINE = arg('engine', 'webkit');
const OUT = arg('out', 'out/mobile-check');
const EMAIL = arg('email', 'dev@local.test');
const LOG = arg('log', '.qa-magic-links.log');
const RECIPE = arg('recipe', null);
export const PRESETS = { safari: 664, 'safari-full': 750, pwa: 844 };
const BOTTOM_ZONE = 80;

mkdirSync(OUT, { recursive: true });
const browser = await ({ chromium, webkit })[ENGINE].launch();
const port = new URL(URL_).port || '80';
const STATE = `out/.mc-state-${port}.json`;
if (!existsSync(STATE)) {
  const c = await browser.newContext(); const p = await c.newPage();
  await p.goto(`${URL_}/`, { waitUntil: 'domcontentloaded' });
  await p.request.post(`${URL_}/v1/auth/request`, { data: { email: EMAIL } });
  await p.waitForTimeout(700);
  const line = readFileSync(LOG, 'utf8').trim().split('\n').at(-1) ?? '';
  const link = line.match(/https?:\S*token=\S+/)?.[0];
  if (!link) { console.error('mobile-scroll-check: magic link не знайдено в', LOG); process.exit(1); }
  await p.goto(link.replace(/^https?:\/\/[^/]+/, URL_), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(800); mkdirSync('out', { recursive: true }); await c.storageState({ path: STATE }); await c.close();
}

const SCREENS = [
  { id: 'app', path: '/app', action: 'textarea' },
  { id: 'recipes', path: '/recipes', first: '[data-filter]' },
  { id: 'pantry', path: '/pantry', first: '[data-zone-chip]' },
  { id: 'list', path: '/list', action: 'input[aria-label="Додати в список"]', actionAtBottom: true },
  { id: 'journal', path: '/cooklog' },
  { id: 'recipe', path: RECIPE ? `/recipe/${RECIPE}` : '/recipes', action: RECIPE ? '[data-cook]' : null },
  { id: 'profile', path: '/profile', first: '[contenteditable]' },
  { id: 'calendar', path: '/calendar', first: '[data-subscriptions]' },
  { id: 'welcome-intake', path: '/welcome', storage: { 'kos-onb-step': '11' }, action: '[data-intake-next]' },
];

const MEASURE = ({ first, action, zone }) => {
  const vh = innerHeight;
  const scrollers = [...document.querySelectorAll('*')].filter((e) => { const cs = getComputedStyle(e); return /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1 && e.clientHeight > 200; });
  const sc = scrollers[0];
  const fe = first ? document.querySelector(first) : null;
  const f = fe?.getBoundingClientRect();
  const rowH = fe ? Math.round(fe.parentElement.getBoundingClientRect().height) : null;
  const a = action ? document.querySelector(action)?.getBoundingClientRect() : null;
  const bar = document.querySelector('[data-tab-bar]')?.getBoundingClientRect();
  return {
    vh, scrollY: Math.round(scrollY), docH: document.documentElement.scrollHeight,
    scroller: sc ? { top: Math.round(sc.getBoundingClientRect().top), scrollTop: Math.round(sc.scrollTop), client: sc.clientHeight, scroll: sc.scrollHeight } : null,
    first: f ? { top: Math.round(f.top), bottom: Math.round(f.bottom), rowH, visible: f.top >= 0 && f.bottom <= vh && rowH >= f.height - 1 } : null,
    action: a ? { bottom: Math.round(a.bottom), aboveZone: a.bottom <= vh - zone && a.top >= 0 } : null,
    bar: bar ? { bottom: Math.round(bar.bottom), atEdge: Math.abs(bar.bottom - vh) <= 1 } : null,
  };
};

const rows = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: PRESETS.safari }, hasTouch: true, deviceScaleFactor: 2, userAgent: devices['iPhone 14'].userAgent, storageState: STATE });
const page = await ctx.newPage();
for (const s of SCREENS) {
  if (s.storage) await ctx.addInitScript((st) => { for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v); }, s.storage);
  const row = { screen: s.id, ok: true, notes: [] };
  const check = (tag, m) => {
    const bad = [];
    if (m.scrollY !== 0) bad.push('scrollY ' + m.scrollY);
    if (m.docH > m.vh) bad.push(`документ ${m.docH} > вʼюпорт ${m.vh}`);
    if (s.first && m.first && !m.first.visible) bad.push(`перший елемент ${m.first.top}..${m.first.bottom} поза вʼюпортом або ряд стиснутий (${m.first.rowH} px)`);
    if (m.bar && !m.bar.atEdge) bad.push(`бар не при краю (${m.bar.bottom} vs ${m.vh})`);
    if (s.action && m.action && !m.action.aboveZone) bad.push(`дія ${m.action.bottom} у нижніх ${BOTTOM_ZONE} px (vh ${m.vh})`);
    row[tag] = m; if (bad.length) { row.ok = false; row.notes.push(`${tag}: ${bad.join('; ')}`); }
  };
  for (const [preset, h] of Object.entries(PRESETS)) {
    await page.setViewportSize({ width: 390, height: h });
    await page.goto(`${URL_}${s.path}`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2000);
    if (s.actionAtBottom) { await page.evaluate(() => { for (const el of document.querySelectorAll('*')) { const cs = getComputedStyle(el); if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) el.scrollTop = el.scrollHeight; } }); await page.waitForTimeout(300); }
    check(preset, await page.evaluate(MEASURE, { first: s.first ?? null, action: s.action ?? null, zone: BOTTOM_ZONE }));
    await page.screenshot({ path: `${OUT}/${ENGINE}-${s.id}-${preset}.png` });
    if (preset === 'safari') {
      // Тулбар сховався й повернувся: 664 → 750 → 664 без перезавантаження.
      const before = row.safari.scroller?.scrollTop ?? 0;
      await page.setViewportSize({ width: 390, height: PRESETS['safari-full'] }); await page.waitForTimeout(500);
      const m1 = await page.evaluate(MEASURE, { first: s.first ?? null, action: s.action ?? null, zone: BOTTOM_ZONE }); check('safari→full', m1);
      await page.screenshot({ path: `${OUT}/${ENGINE}-${s.id}-safari-to-full.png` });
      await page.setViewportSize({ width: 390, height: PRESETS.safari }); await page.waitForTimeout(500);
      const m2 = await page.evaluate(MEASURE, { first: s.first ?? null, action: s.action ?? null, zone: BOTTOM_ZONE }); check('full→safari', m2);
      if ((m1.scroller?.scrollTop ?? 0) !== before || (m2.scroller?.scrollTop ?? 0) !== before) { row.ok = false; row.notes.push(`scrollTop змінився при переході: ${before} → ${m1.scroller?.scrollTop} → ${m2.scroller?.scrollTop}`); }
    }
  }
  rows.push(row);
  console.log(`${row.ok ? '✅' : '❌'} ${s.id}: 664 scrollTop=${row.safari.scroller?.scrollTop ?? '-'} first=${row.safari.first ? `${row.safari.first.top}..${row.safari.first.bottom}` : '-'} action=${row.safari.action?.bottom ?? '-'}/${row.safari.vh} · 750 action=${row['safari-full'].action?.bottom ?? '-'}/${row['safari-full'].vh} · 844 action=${row.pwa.action?.bottom ?? '-'}/${row.pwa.vh}${row.notes.length ? '\n   ' + row.notes.join('\n   ') : ''}`);
}
writeFileSync(`${OUT}/report-${ENGINE}.json`, JSON.stringify(rows, null, 1));
await browser.close();
process.exit(rows.every((r) => r.ok) ? 0 : 2);
