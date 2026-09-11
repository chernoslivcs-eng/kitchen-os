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
// --click   селектор у застосунку, по якому клікнути перед знімком (відкрити артефакт тощо)
// --dc-click селектор у бандлі, по якому клікнути перед знімком кадра (Prototype: вкладка nav)
// --dc-wait мс після кліку в бандлі (типово 600; прототип відповідає з затримкою — дати 3000)
// --list    лише перелічити data-screen-label у файлі й вийти
// --init-storage key=json[,key=json] — покласти в localStorage застосунку ДО завантаження
//           (стан готування kos-cook-live, ширина панелі kos-rail-width тощо)
// --stub-messages файл JSON із масивом повідомлень (MessageInfo без id/session_id/created_at),
//           які ДОПИСУЮТЬСЯ в кінець відповіді GET /v1/session/today і /v1/sessions/:id — лише в цьому
//           знімку, у мережі; база не чіпається. Для карток, яких стаб не віддає
//           (пропозиції), і для пар без прогонів моделі. Дані — з файлу, не з бази.
//
// Бандл читається з file:// і потребує мережі для шрифту Onest і lucide з
// unpkg — так само, як його дивиться дизайн-чат. Застосунок — лише локальний
// або засів (той самий запобіжник, що в design-audit).

import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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
if (THEME === 'dark') {
  await dcPage.$$eval('.v3', (els) => els.forEach((e) => e.setAttribute('data-theme', 'dark')));
  await dcPage.waitForTimeout(300);
}
const frameSel = SEL ?? `[data-screen-label*="${FRAME}"]`;
const frames = await dcPage.$$(frameSel);
if (!frames[NTH]) { console.error(`side-by-side: кадр не знайдено — ${frameSel} [${NTH}] у ${DC}`); await browser.close(); process.exit(1); }
const frame = frames[NTH];
await frame.scrollIntoViewIfNeeded();
const dcClick = arg('dc-click', null);
if (dcClick) { await frame.waitForSelector(dcClick, { timeout: 15000 }); await frame.$eval(dcClick, (el) => el.click()); await dcPage.waitForTimeout(Number(arg('dc-wait', 600))); }
const frameLabel = (await frame.getAttribute('data-screen-label')) ?? SEL;
const frameBox = await frame.boundingBox();
const framePng = await frame.screenshot({ type: 'png' });

// ── запобіжник теми ────────────────────────────────────────────────────────
// Того самого роду, що гейти на гліфи й токени: інструмент не має права
// мовчки віддати не той стан. Полотно кадра й полотно застосунку читаються
// після рендеру; просили dark — обидва мають бути темними, інакше падіння,
// а не збережена «темна» пара, яка насправді світла.
const lumOf = (rgb) => {
  const m = rgb.match(/\d+(\.\d+)?/g)?.map(Number) ?? [255, 255, 255];
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
};
const assertTheme = (who, rgb) => {
  const lum = lumOf(rgb);
  const dark = lum < 0.2, light = lum > 0.5;
  if ((THEME === 'dark' && !dark) || (THEME === 'light' && !light)) {
    console.error(`side-by-side: відмова — просили ${THEME}, а полотно ${who} = ${rgb} (яскравість ${lum.toFixed(3)}). Пару не збережено.`);
    process.exit(3);
  }
};
assertTheme('кадра', await frame.evaluate((el) => {
  // Перший предок із непрозорим тлом — саме полотно кадра.
  let e = el; while (e) { const b = getComputedStyle(e).backgroundColor; if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') return b; e = e.parentElement; } return 'rgb(255,255,255)';
}));

// ── рендер застосунку ──────────────────────────────────────────────────────
let appPng = null; let appNote = 'застосунок не знімався (--url не задано)';
if (URL_BASE) {
  // Сесія кешується у файлі стану (--state, типово out/.sbs-state.json):
  // magic-link має ліміт 5 на 15 хв, а пар на здачу — десять.
  const STATE_FILE = STATE ?? 'out/.sbs-state.json';
  const haveState = existsSync(STATE_FILE);
  const appCtx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2,
    ...(haveState ? { storageState: STATE_FILE } : {}),
    ...(WIDTH < 768 ? { isMobile: true, hasTouch: true } : {}),
  });
  const initStorage = arg('init-storage', null);
  if (initStorage) {
    const pairs = initStorage.split(/,(?=[a-zA-Z_-]+=)/).map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; });
    await appCtx.addInitScript((entries) => { for (const [k, v] of entries) localStorage.setItem(k, v); }, pairs);
  }
  const page = await appCtx.newPage();
  await page.emulateMedia({ colorScheme: THEME });
  const stubFile = arg('stub-messages', null);
  if (stubFile) {
    const extra = JSON.parse(readFileSync(stubFile, 'utf8'));
    await page.route(/\/v1\/(session\/today|sessions\/[^/?]+)(\?.*)?$/, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const res = await route.fetch();
      const body = await res.json();
      const last = body.messages?.at(-1);
      const base = last ? new Date(last.created_at).getTime() : Date.now();
      body.messages = [...(body.messages ?? []), ...extra.map((m, i) => ({
        id: `stub-${i}`, session_id: body.session?.id ?? '', role: 'assistant', text: null, card: null, applied: 0,
        created_at: new Date(base + 60_000 * (i + 1)).toISOString(), ...m,
      }))];
      await route.fulfill({ response: res, json: body });
    });
  }
  await page.goto(`${URL_BASE}/`, { waitUntil: 'domcontentloaded' });
  if (EMAIL && !haveState) {
    // Той самий вхід, що в design-audit: magic link із локального логу.
    await page.request.post(`${URL_BASE}/v1/auth/request`, { data: { email: EMAIL } });
    await page.waitForTimeout(600);
    const line = readFileSync(LOG, 'utf8').trim().split('\n').at(-1) ?? '';
    const link = line.match(/https?:\S*token=\S+/)?.[0];
    if (!link) { console.error('side-by-side: magic link не знайдено в логу'); await browser.close(); process.exit(1); }
    await page.goto(link.replace(/^https?:\/\/[^/]+/, URL_BASE), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    mkdirSync(dirname(resolve(STATE_FILE)), { recursive: true });
    await appCtx.storageState({ path: STATE_FILE });
  }
  await page.goto(`${URL_BASE}${arg('path', new URL(URL_BASE).pathname === '/' ? '' : '')}`, { waitUntil: 'domcontentloaded' });
  const path = arg('path', null);
  if (path) await page.goto(`${URL_BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const click = arg('click', null);
  if (click) { await page.click(click); await page.waitForTimeout(800); }
  assertTheme('застосунку', await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
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
