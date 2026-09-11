#!/usr/bin/env node
// Вимірювач дизайн-системи. Не тест — звіт: ганяємо ДО і ПІСЛЯ С1–С3 і
// порівнюємо числа, щоб «прийнято / не прийнято» не було питанням смаку.
//
//   node scripts/design-audit.mjs --url http://localhost:5173 \
//        --email dev@local.test --log .qa-magic-links.log
//   node scripts/design-audit.mjs --url http://localhost:4173 --state e2e/.auth/state.json
//
// Критерії з TASK-DESIGN-SYSTEM.md §С1–С3.

import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const URL_BASE = arg('url', 'http://localhost:5173').replace(/\/$/, '');
const STATE = arg('state', null);
const EMAIL = arg('email', null);
const LOG = arg('log', '.qa-magic-links.log');
const WIDTH = Number(arg('width', 1440));
const HEIGHT = Number(arg('height', 900));
// Тема: light | dark | auto. Пороги обох тем однакові (audit-thresholds), а
// провал контрасту в одній темі не видно з іншої — тому прогін на кожну.
const THEME = arg('theme', 'auto');

// Запобіжник (DEBT §37): аудит ганяється лише на локальному чи на засіві.
// Скрипт не клікає — лише goto + evaluate, — але логіниться через
// POST /v1/auth/request, а це на проді — лист і сесія в живому домі. Тому
// прод відкидається за адресою, а не за домовленістю.
const PROD_HOSTS = [/vercel\.app$/i, /kitchen-os/i];
try {
  const host = new URL(URL_BASE).hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  if (!local && PROD_HOSTS.some((re) => re.test(host))) {
    console.error(`design-audit: відмова — ${host} схоже на прод. Аудит ганяється лише локально або на засіві.`);
    process.exit(2);
  }
} catch {
  console.error(`design-audit: --url не адреса: ${URL_BASE}`);
  process.exit(2);
}

const SCREENS = [
  ['Кухня', '/app'], ['Комора', '/pantry'], ['Рецепти', '/recipes'],
  ['Список', '/list'], ['Календар', '/calendar'], ['Профіль', '/profile'],
];

// Пороги приймання — з ai/project/audit-thresholds.md (рішення Р14, 10.09:
// audit-thresholds перемагає; TASK-DESIGN-SYSTEM.md §С1–С3 з його «шість
// ролей» — історія, того ж роду, що тека design/).
const MAX_COMBOS = 8;        // стилів (кегль × вага × гарнітура) на екран
const MAX_ROLES = 6;         // Р14, додаток: ролей .t-* на ОДНОМУ екрані
const RATIO_LO = 1.9;        // display ÷ body = 2.0 ± 0.1 (32/16)
const RATIO_HI = 2.1;
const COMMON_LO = 14;        // найчастіший кегль — контент, не мікро-мітка
const COMMON_HI = 16;
const MAX_SIZE = 32;         // h1; display (112) лише в Cook Mode, його тут нема
const DISPLAY_MAX = 2;       // заголовок + одне число
const MAX_FAMILIES = 1;      // Onest. Червоне до етапу 1.6 (Р19)
const MAX_WEIGHTS = 3;       // 400/500/600; 700 лише на дисплейному кеглі
const MAX_EM_ROWS = 3;       // ⚠1 (10.09): виділених рядків на екран
const MAX_EM_CARDS = 1;      // ⚠1: плюс одна картка-акцент
const DISPLAY_MIN = 32;      // що вважаємо дисплейним поверхом
const AA = 4.5;              // контраст звичайного тексту

// Р24 (10.09): міряємо не «скільки написань трекінгу всього», а скільки їх
// ПОЗА таблицею ролей — і цього має бути нуль. Метрика стоїть проти
// розсипання значень по компонентах, а не проти того, що ролей десять.
const ROLE_TRACKS = ['-0.03em', '-0.02em', '-0.01em', '0.01em', '-0.04em', '0px', 'normal'];

const PROBE = ({ DISPLAY_MIN, AA, ROLE_TRACKS }) => {
  const px = (c) => (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
  const lum = (rgb) => { const s = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]; };
  const cr = (a, b) => { const l1 = lum(px(a)), l2 = lum(px(b)); const [h, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return +(((h + 0.05) / (lo + 0.05)).toFixed(2)); };
  const opaque = (c) => c && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(c);
  const bgOf = (el) => { let n = el; while (n && n !== document.documentElement) { const c = getComputedStyle(n).backgroundColor; if (opaque(c)) return c; n = n.parentElement; } return getComputedStyle(document.body).backgroundColor || 'rgb(255,255,255)'; };
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };

  const combos = new Map();
  const roleClasses = new Set();
  const families = new Set();
  const weights = new Set();
  const heavySmall = [];
  const trackOutside = new Set();
  const inlineSizes = [];
  const emRows = [];
  const lowContrast = [];
  const display = [];
  const glyphNodes = [];
  const GLYPH = /^[\s←-⇿⌀-⏿■-◿☀-➿！-～]+$/;

  for (const el of document.querySelectorAll('body *')) {
    if (!onScreen(el) || !ownText(el)) continue;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '');
    const text = el.textContent.trim();
    const key = `${size}|${cs.fontWeight}|${fam}`;
    if (!combos.has(key)) combos.set(key, { size, weight: cs.fontWeight, fam, sample: text.slice(0, 24), n: 0 });
    combos.get(key).n++;
    if (size >= DISPLAY_MIN) display.push(text.slice(0, 30));
    const bg = bgOf(el);
    const ratio = cr(cs.color, bg);
    if (ratio < AA && text.length > 0) lowContrast.push({ ratio, size, color: cs.color, bg, sample: text.slice(0, 28) });
    if (GLYPH.test(text) && text.replace(/\s/g, '').length > 0 && text.replace(/\s/g, '').length <= 3) glyphNodes.push(text.trim());

    // Ролі .t-* — скільки їх живе на цьому екрані (Р14, додаток).
    for (const c of el.classList) if (/^t-/.test(c)) roleClasses.add(c);
    families.add(fam);
    weights.add(cs.fontWeight);
    // 700 дозволена лише на дисплейному кеглі (h1 / display).
    if (Number(cs.fontWeight) >= 700 && size < DISPLAY_MIN) heavySmall.push(`${size}px «${text.slice(0, 20)}»`);
    // Трекінг поза таблицею ролей (Р24).
    // px → em із двома знаками. (Було ×1000/100 — усі значення виходили в
    // десять разів більшими, і роль -0.02em показувалась як -0.2em, тобто
    // метрика лаяла власний канон.)
    const ls = cs.letterSpacing === 'normal' ? 'normal' : `${Math.round((parseFloat(cs.letterSpacing) / size) * 100) / 100}em`;
    const lsRaw = cs.letterSpacing;
    if (!ROLE_TRACKS.includes(lsRaw) && !ROLE_TRACKS.includes(ls) && parseFloat(lsRaw) !== 0) trackOutside.add(`${ls} (${size}px)`);
    // Кегль інлайном у розмітці — 0 за каноном: лише ролі.
    if (/font-size/.test(el.getAttribute('style') ?? '')) inlineSizes.push(text.slice(0, 20));
    // Емфаза (⚠1): рядок у кеглі рядка-списку з вагою ≥ 600.
    // Логотип і назва бренду — знак, не виділений рядок (TabBar `brand-name`):
    // інакше метрика ловить сама себе на кожному екрані.
    if (Number(cs.fontWeight) >= 600 && size >= 15 && size <= 17 && !el.closest('[class*=ogo], [class*=brand]')) emRows.push(text.slice(0, 24));
  }

  // роздільники-волосини
  const dividers = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!onScreen(el)) continue;
    const cs = getComputedStyle(el);
    for (const side of ['Top', 'Bottom', 'Left', 'Right']) {
      const w = parseFloat(cs[`border${side}Width`]);
      if (w > 0 && w <= 1.5 && cs[`border${side}Style`] !== 'none') {
        dividers.push(cr(cs[`border${side}Color`], bgOf(el.parentElement || el)));
      }
    }
  }

  const list = [...combos.values()].sort((a, b) => b.size - a.size);
  const sizes = list.map((c) => c.size);
  // «Тіло» — найчастіший кегль серед НЕ-гліфового тексту: саме проти нього
  // міряється дисплейний поверх. Раніше сюди потрапляв 17px гліфів навігації.
  // «Тіло» — найчастіший кегль читомого тексту: не моно, не гліф, ≥3 літери.
  const wordy = [...combos.values()].filter((c) => !/mono/i.test(c.fam) && /[\p{L}]{3,}/u.test(c.sample));
  const byCount = new Map();
  for (const c of wordy) byCount.set(c.size, (byCount.get(c.size) ?? 0) + c.n);
  const body = [...byCount.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? sizes.at(-1);
  // Окремо — найчастіший кегль узагалі, разом із мітками. Саме він показує,
  // у якій смузі насправді живе екран.
  const anyCount = new Map();
  for (const c of combos.values()) anyCount.set(c.size, (anyCount.get(c.size) ?? 0) + c.n);
  const commonest = [...anyCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  // Навігація — підписи цілей у TabBar, не гліфи й не бренд.
  const navEls = [...document.querySelectorAll('[data-nav-scroll] > button, nav a, nav button')];
  const navSizes = navEls.flatMap((e) => [...e.querySelectorAll('span'), e]
    .filter((n) => /[\p{L}]{3,}/u.test(n.textContent ?? ''))
    .map((n) => parseFloat(getComputedStyle(n).fontSize)));
  const nav = navSizes.length ? Math.max(...navSizes) : null;

  return {
    combos: list.length,
    top: list.slice(0, 6).map((c) => `${c.size}/${c.weight} ${c.fam.slice(0, 10)} · ${c.sample}`),
    maxSize: sizes[0], minSize: sizes.at(-1), bodySize: body, commonest,
    ratio: sizes[0] && body ? +(sizes[0] / body).toFixed(2) : null,
    displayCount: display.length, displaySamples: display.slice(0, 3),
    dividers: dividers.length,
    dividersInvisible: dividers.filter((r) => r < 1.5).length,
    dividerMin: dividers.length ? Math.min(...dividers) : null,
    contrastFails: lowContrast.length,
    worstContrast: lowContrast.sort((a, b) => a.ratio - b.ratio).slice(0, 3),
    navSize: nav,
    glyphs: [...new Set(glyphNodes)],
    roles: roleClasses.size, roleList: [...roleClasses],
    families: families.size, familyList: [...families],
    weights: [...weights].sort(), heavySmall: heavySmall.slice(0, 3),
    trackOutside: [...trackOutside],
    inlineSizes: inlineSizes.length, inlineSamples: inlineSizes.slice(0, 3),
    emRows: emRows.length, emSamples: emRows.slice(0, 4),
  };
};

// «Чисел на екрані до приходу даних — 0» (audit-thresholds). Міряється тільки
// поки скелетон ще на місці: коли дані вже прийшли, числа законні.
const DIGITS = () => {
  const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight; };
  const skeleton = [...document.querySelectorAll('[class*=keleton], [class*=kelet]')].some(onScreen);
  if (!skeleton) return { skeleton: false, digits: [] };
  const digits = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!onScreen(el)) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const t = el.textContent.trim();
    if (/\d/.test(t) && t.length <= 40) digits.push(t.slice(0, 24));
  }
  return { skeleton: true, digits: [...new Set(digits)] };
};

async function login(ctx, page) {
  if (!EMAIL) return;
  const r = await page.request.post(`${URL_BASE}/v1/auth/request`, { data: { email: EMAIL } });
  if (!r.ok()) throw new Error(`auth/request: ${r.status()}`);
  await new Promise((res) => setTimeout(res, 400));
  const line = readFileSync(LOG, 'utf-8').trim().split('\n').reverse().find((l) => l.includes('token='));
  const token = /token=([^\s&]+)/.exec(line)[1];
  const v = await page.request.get(`${URL_BASE}/v1/auth/verify?token=${token}`);
  if (!v.ok()) throw new Error(`auth/verify: ${v.status()}`);
}

const pad = (s, n) => String(s ?? '—').padEnd(n);
const num = (s, n) => String(s ?? '—').padStart(n);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  ...(STATE ? { storageState: STATE } : {}),
});
const page = await ctx.newPage();
// Застосунок іде за prefers-color-scheme, поки людина не обрала тему руками
// (theme.ts). Емуляція медіа — той самий шлях, що в людини, не підміна атрибута.
if (THEME !== 'auto') await page.emulateMedia({ colorScheme: THEME });
await page.goto(`${URL_BASE}/`);
await login(ctx, page);

console.log(`\nДизайн-аудит · ${URL_BASE} · ${WIDTH}×${HEIGHT} · тема ${THEME}\n`);
console.log(pad('екран', 10) + num('стилів', 7) + num('макс', 6) + num('тіло', 6) + num('÷', 6) + num('часто', 7) + num('display', 9) + num('ліній', 7) + num('невид.', 8) + num('контраст<4.5', 14));
console.log('─'.repeat(80));

const all = [];
for (const [name, path] of SCREENS) {
  await page.goto(`${URL_BASE}${path}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const early = await page.evaluate(DIGITS).catch(() => ({ skeleton: false, digits: [] }));
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
  const r = await page.evaluate(PROBE, { DISPLAY_MIN, AA, ROLE_TRACKS });
  r.early = early;
  all.push([name, r]);
  console.log(
    pad(name, 10) + num(r.combos, 7) + num(r.maxSize, 6) + num(r.bodySize, 6) +
    num(r.ratio, 6) + num(r.commonest, 7) + num(r.displayCount, 9) + num(r.dividers, 7) +
    num(r.dividersInvisible, 8) + num(r.contrastFails, 14),
  );
}

console.log('\nПриймання:');
const fail = [];
for (const [name, r] of all) {
  if (r.combos > MAX_COMBOS) fail.push(`${name}: ${r.combos} стилів, треба ≤ ${MAX_COMBOS}`);
  if (r.roles > MAX_ROLES) fail.push(`${name}: ролей .t-* на екрані ${r.roles}, треба ≤ ${MAX_ROLES} — ${r.roleList.join(' ')}`);
  if (r.displayCount > DISPLAY_MAX) fail.push(`${name}: дисплейних елементів ${r.displayCount}, треба ≤ ${DISPLAY_MAX}`);
  if (r.ratio != null && (r.ratio < RATIO_LO || r.ratio > RATIO_HI)) fail.push(`${name}: display ÷ body = ${r.ratio}, треба ${RATIO_LO}–${RATIO_HI}`);
  if (r.maxSize > MAX_SIZE) fail.push(`${name}: макс. кегль ${r.maxSize}, треба ≤ ${MAX_SIZE} (112 лише в Cook Mode)`);
  if (r.commonest != null && (r.commonest < COMMON_LO || r.commonest > COMMON_HI)) fail.push(`${name}: найчастіший кегль ${r.commonest}, треба ${COMMON_LO}–${COMMON_HI}`);
  if (r.families > MAX_FAMILIES) fail.push(`${name}: гарнітур ${r.families} (${r.familyList.join(', ')}), треба ${MAX_FAMILIES} — етап 1.6, Р19`);
  if (r.weights.length > MAX_WEIGHTS) fail.push(`${name}: ваг ${r.weights.length} (${r.weights.join('/')}), треба ≤ ${MAX_WEIGHTS}`);
  if (r.heavySmall.length) fail.push(`${name}: вага 700 на недисплейному кеглі — ${r.heavySmall.join(', ')}`);
  if (r.trackOutside.length) fail.push(`${name}: трекінг поза таблицею ролей — ${r.trackOutside.join(', ')} (Р24)`);
  if (r.inlineSizes > 0) fail.push(`${name}: кегль інлайном у ${r.inlineSizes} місцях — ${r.inlineSamples.join(' · ')}`);
  if (r.emRows > MAX_EM_ROWS) fail.push(`${name}: виділених рядків ${r.emRows}, треба ≤ ${MAX_EM_ROWS} + ${MAX_EM_CARDS} картка (⚠1) — ${r.emSamples.join(' · ')}`);
  if (r.early?.skeleton && r.early.digits.length) fail.push(`${name}: числа на екрані до приходу даних — ${r.early.digits.slice(0, 4).join(' · ')}`);
  if (r.dividersInvisible > 0) fail.push(`${name}: ${r.dividersInvisible} роздільників контрастом < 1.5`);
  if (r.contrastFails > 0) fail.push(`${name}: ${r.contrastFails} текстів нижче AA (гірший ${r.worstContrast[0]?.ratio} — «${r.worstContrast[0]?.sample}»)`);
  if (r.glyphs.length) fail.push(`${name}: текстові гліфи в ролі іконок — ${r.glyphs.join(' ')}`);
  if (r.navSize && r.bodySize && r.navSize < r.bodySize) fail.push(`${name}: навігація ${r.navSize}px дрібніша за контент ${r.bodySize}px`);
}
if (!fail.length) console.log('  усе чисто');
else fail.forEach((f) => console.log(`  ✗ ${f}`));

console.log('\nЩо цим прогоном НЕ міряється:');
console.log('  · картка-акцент (⚠1, ≤ 1 на екран) — потрібен маркер у розмітці, зʼявиться в 2a');
console.log('  · Cook Mode (роль display 112) — не входить у список екранів');
console.log('  · темна тема — окремий прогін, пороги ті самі');

console.log('\nНайбільші кеглі на Коморі:');
(all.find(([n]) => n === 'Комора')?.[1].top ?? []).forEach((t) => console.log(`  ${t}`));

await browser.close();
process.exit(0);
