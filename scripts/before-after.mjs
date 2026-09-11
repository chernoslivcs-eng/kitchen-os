#!/usr/bin/env node
// Пара «було · стало»: той самий кадр застосунку з двох серверів — main і
// гілки правок — у тій самій ширині й темі. Здача пакета правок (FIXES-V3):
// кожен пункт — одна пара на кадр, обидві теми. Доповнює side-by-side.mjs
// (кадр бандла проти рендеру): тут бандла нема, обидві половини — рендер.
//
//   node scripts/before-after.mjs --name 06-icons-rail --path /app --width 1440 --theme both
//
// --before  URL сервера «було» (типово http://localhost:5191 — vite із .worktrees/stand-main)
// --after   URL сервера «стало» (типово http://localhost:5190 — vite із гілки)
// --name    імʼя пари → docs/superpowers/plans/side-by-side/pack-1/<name>-<theme>.png
// --theme   light | dark | both (типово both — окремий файл на тему)
// --path · --width · --height · --email · --log · --click · --init-storage ·
// --stub-json · --stub-messages · --stub-rest · --app-sel · --full · --reduce ·
// --stub-any prefix=STATUS  будь-який метод за префіксом шляху (POST теж) — «не записалось»
// --scale — те саме, що в side-by-side.mjs (див. там)
// --hover SEL      навести курсор перед знімком (стан наведення рядка, ручки)
// --actions "a ;; b"  кроки перед знімком/під час запису: click:SEL · hover:SEL ·
//           move:X,Y · wait:MS · press:KEY · type:TEXT · focus:SEL · swipe:SEL:up ·
//           down:SEL · drag:X,Y · up:  (перетягування без відпускання — стан ручки)
// --video N  замість знімка — запис N секунд (webm на кожну половину, поруч
//           не клеїться); кроки з --actions виконуються під час запису
// --label-before / --label-after  підписи половин (типово main · гілка)
//
// Обидва сервери — лише локальні (той самий запобіжник, що в side-by-side).
// Сесія кешується на origin (out/.ba-state-<port>.json): magic-link має
// ліміт 5 на 15 хв.

import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(`--${k}`);

const BEFORE = (arg('before', 'http://localhost:5191')).replace(/\/$/, '');
const AFTER = (arg('after', 'http://localhost:5190')).replace(/\/$/, '');
const NAME = arg('name', 'pair');
const OUT_DIR = arg('out-dir', 'docs/superpowers/plans/side-by-side/pack-1');
const WIDTH = Number(arg('width', 1440));
const HEIGHT = Number(arg('height', WIDTH <= 480 ? 844 : 900));
const THEMES = arg('theme', 'both') === 'both' ? ['light', 'dark'] : [arg('theme')];
const EMAIL = arg('email', 'dev@local.test');
const LOG = arg('log', '.qa-magic-links.log');
const SCALE = Number(arg('scale', 2));
const REDUCE = has('reduce');
const VIDEO = Number(arg('video', 0));
const LABELS = { before: arg('label-before', 'Було · main'), after: arg('label-after', 'Стало · fix/v3-pack-1') };

for (const u of [BEFORE, AFTER]) {
  const host = new URL(u).hostname;
  if (!(host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local'))) { console.error(`before-after: відмова — ${host} не локальний.`); process.exit(2); }
}

const lumOf = (rgb) => {
  const m = rgb.match(/\d+(\.\d+)?/g)?.map(Number) ?? [255, 255, 255];
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
};

const browser = await chromium.launch();

async function runActions(page, spec) {
  if (!spec) return;
  for (const step of spec.split(';;').map((x) => x.trim()).filter(Boolean)) {
    const i = step.indexOf(':'); const op = step.slice(0, i); const v = step.slice(i + 1);
    if (op === 'click') await page.click(v);
    else if (op === 'hover') await page.hover(v);
    else if (op === 'move') { const [x, y] = v.split(',').map(Number); await page.mouse.move(x, y, { steps: 8 }); }
    else if (op === 'wait') await page.waitForTimeout(Number(v));
    else if (op === 'press') await page.keyboard.press(v);
    else if (op === 'type') await page.keyboard.type(v, { delay: 40 });
    else if (op === 'focus') await page.focus(v);
    else if (op === 'down') { const bb = await (await page.waitForSelector(v)).boundingBox(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); }
    else if (op === 'drag') { const [dx, dy] = v.split(',').map(Number); await page.mouse.move(dx, dy, { steps: 8 }); }
    else if (op === 'up') await page.mouse.up();
    else if (op === 'swipe') {
      const [sel, dir] = v.split(':'); const bb = await (await page.waitForSelector(sel)).boundingBox();
      const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2; const dy = dir === 'up' ? -80 : 80;
      await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy + dy, { steps: 6 }); await page.mouse.up();
    }
    else throw new Error(`before-after: невідомий крок «${step}»`);
    await page.waitForTimeout(250);
  }
}

async function shoot(base, theme, side) {
  const port = new URL(base).port || '80';
  const STATE_FILE = `out/.ba-state-${port}.json`;
  const haveState = existsSync(STATE_FILE);
  const videoDir = VIDEO ? join('out', `.ba-video-${port}`) : null;
  if (videoDir) rmSync(videoDir, { recursive: true, force: true });
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: SCALE, reducedMotion: REDUCE ? 'reduce' : 'no-preference',
    ...(haveState ? { storageState: STATE_FILE } : {}),
    ...(WIDTH < 768 ? { isMobile: true, hasTouch: true } : {}),
    ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: WIDTH, height: HEIGHT } } } : {}),
  });
  const initStorage = arg('init-storage', null);
  if (initStorage) {
    const pairs = initStorage.split(/,(?=[a-zA-Z_-]+=)/).map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; });
    await ctx.addInitScript((entries) => { for (const [k, v] of entries) localStorage.setItem(k, v); }, pairs);
  }
  const page = await ctx.newPage();
  await page.emulateMedia({ colorScheme: theme });
  const stubRest = arg('stub-rest', null);
  if (stubRest) await page.route((u) => u.pathname.startsWith('/v1/'), (route) => route.request().method() !== 'GET' ? route.continue() : stubRest === 'abort' ? route.abort('internetdisconnected') : route.fulfill({ status: Number(stubRest), contentType: 'application/json', body: '{}' }));
  const stubJson = arg('stub-json', null);
  if (stubJson) {
    for (const pair of stubJson.split(';')) {
      const i = pair.indexOf('='); const path = pair.slice(0, i).trim(); const val = pair.slice(i + 1).trim();
      await page.route((u) => u.pathname === path, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        if (val === 'abort') return route.abort('internetdisconnected');
        if (/^\d{3}$/.test(val)) return route.fulfill({ status: Number(val), contentType: 'application/json', body: '{}' });
        return route.fulfill({ status: 200, contentType: 'application/json', body: val });
      });
    }
  }
  // --stub-any prefix=STATUS[;prefix=STATUS] — будь-який метод, шлях за префіксом
  // (POST/PATCH теж): «запис не пройшов» → тост помилки, без бази.
  const stubAny = arg('stub-any', null);
  if (stubAny) {
    for (const pair of stubAny.split(';')) {
      const i = pair.indexOf('='); const prefix = pair.slice(0, i).trim(); const val = pair.slice(i + 1).trim();
      await page.route((u) => u.pathname.startsWith(prefix), (route) => val === 'abort' ? route.abort('internetdisconnected') : route.fulfill({ status: Number(val), contentType: 'application/json', body: '{"error":"stub"}' }));
    }
  }
  const stubFile = arg('stub-messages', null);
  if (stubFile) {
    const extra = JSON.parse(readFileSync(stubFile, 'utf8'));
    await page.route(/\/v1\/(session\/today|sessions\/[^/?]+)(\?.*)?$/, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const res = await route.fetch();
      const body = await res.json();
      const last = body.messages?.at(-1);
      const b = last ? new Date(last.created_at).getTime() : Date.now();
      body.messages = [...(body.messages ?? []), ...extra.map((m, i) => ({
        id: `stub-${i}`, session_id: body.session?.id ?? '', role: 'assistant', text: null, card: null, applied: 0,
        created_at: new Date(b + 60_000 * (i + 1)).toISOString(), ...m,
      }))];
      await route.fulfill({ response: res, json: body });
    });
  }
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  if (EMAIL && !haveState && !has('no-login')) {
    await page.request.post(`${base}/v1/auth/request`, { data: { email: EMAIL } });
    await page.waitForTimeout(600);
    const line = readFileSync(LOG, 'utf8').trim().split('\n').at(-1) ?? '';
    const link = line.match(/https?:\S*token=\S+/)?.[0];
    if (!link) { console.error('before-after: magic link не знайдено в логу'); await browser.close(); process.exit(1); }
    await page.goto(link.replace(/^https?:\/\/[^/]+/, base), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    mkdirSync(dirname(resolve(STATE_FILE)), { recursive: true });
    await ctx.storageState({ path: STATE_FILE });
  }
  const path = arg('path', '/');
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const click = arg('click', null);
  if (click) { for (const sel of click.split(';;').map((x) => x.trim()).filter(Boolean)) { await page.click(sel); await page.waitForTimeout(800); } }
  const hover = arg('hover', null);
  if (hover) { await page.hover(hover); await page.waitForTimeout(400); }
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lum = lumOf(bg);
  if ((theme === 'dark' && lum >= 0.2) || (theme === 'light' && lum <= 0.5)) {
    if (!has('allow-theme-mismatch')) { console.error(`before-after: відмова — просили ${theme}, а полотно «${side}» = ${bg}.`); await browser.close(); process.exit(3); }
    console.warn(`before-after: полотно «${side}» = ${bg} при темі ${theme} (дозволено --allow-theme-mismatch)`);
  }
  let png = null; let imgW = WIDTH;
  if (VIDEO) {
    const t0 = Date.now();
    await runActions(page, arg('actions', null));
    const rest = VIDEO * 1000 - (Date.now() - t0);
    if (rest > 0) await page.waitForTimeout(rest);
    await ctx.close();
    const file = readdirSync(videoDir).find((f) => f.endsWith('.webm'));
    mkdirSync(OUT_DIR, { recursive: true });
    const out = join(OUT_DIR, `${NAME}-${theme}-${side}.webm`);
    copyFileSync(join(videoDir, file), out);
    rmSync(videoDir, { recursive: true, force: true });
    return { video: out };
  }
  await runActions(page, arg('actions', null));
  const appSel = arg('app-sel', null);
  if (appSel) { const el = await page.waitForSelector(appSel, { timeout: 15000 }); png = await el.screenshot({ type: 'png' }); const bb = await el.boundingBox(); if (bb) imgW = Math.round(bb.width); }
  else png = await page.screenshot({ type: 'png', fullPage: has('full') });
  await ctx.close();
  return { png, imgW };
}

const b64 = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
for (const theme of THEMES) {
  const a = await shoot(BEFORE, theme, 'before');
  const b = await shoot(AFTER, theme, 'after');
  if (VIDEO) { console.log(`before-after → ${a.video} · ${b.video}`); continue; }
  const note = `${arg('path', '/')} · ${WIDTH}×${HEIGHT} · ${theme}`;
  const html = `<!doctype html><meta charset="utf-8">
<style>
  body{margin:0;background:#c9ccd0;font:13px/1.4 system-ui;color:#1a1c1e}
  .wrap{display:flex;gap:24px;padding:20px;align-items:flex-start}
  .col{display:flex;flex-direction:column;gap:8px}
  .cap{font-weight:600}.cap span{font-weight:400;color:#6b6f74}
  img{display:block;box-shadow:0 8px 24px rgba(0,0,0,.15);background:#fff}
</style>
<div class="wrap">
  <div class="col"><div class="cap">${LABELS.before} <span>${note}</span></div><img src="${b64(a.png)}" width="${a.imgW}"></div>
  <div class="col"><div class="cap">${LABELS.after} <span>${note}</span></div><img src="${b64(b.png)}" width="${b.imgW}"></div>
</div>`;
  const outCtx = await browser.newContext({ viewport: { width: a.imgW + b.imgW + 100, height: 200 }, deviceScaleFactor: 1 });
  const outPage = await outCtx.newPage();
  await outPage.setContent(html);
  await outPage.waitForTimeout(300);
  const out = join(OUT_DIR, `${NAME}-${theme}.png`);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), await outPage.screenshot({ type: 'png', fullPage: true }));
  await outCtx.close();
  console.log(`before-after → ${out} · ${note}`);
}
await browser.close();
