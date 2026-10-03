#!/usr/bin/env npx tsx
// Рендер листа у файл + кадри 600 і 390 — здача шаблону поруч із макетом.
//
//   npx tsx scripts/mail-preview.mts <тека>
//
// PNG лежать поруч як файли, тому в прев'ю assetsBase — file://…/apps/web/public.
// У проді це APP_URL, і адреси в листі абсолютні (у пошті відносних не буває).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { MAIL, SUBSCRIPTION_PATH } from '../packages/domain/paywall.ts';
import { renderLetter } from '../services/api/src/mail-template.ts';

const out = resolve(process.argv[2] ?? 'out/mail');
mkdirSync(out, { recursive: true });
const assets = `file://${resolve('apps/web/public')}`;

const APP = 'https://kitchen-os.app';
const SUB = `${APP}${SUBSCRIPTION_PATH}`;
const letters = [
  ['01-login', MAIL.login(15, `${APP}/v1/auth/verify?token=demo`)],
  ['03-demo-started', MAIL.demoStarted('10 жовтня', `${APP}/app`)],
  ['04-demo-ending', MAIL.demoEnding('9 жовтня', SUB)],
  ['05a-paused', MAIL.lapsed('demo', SUB)],
  ['05b-cancelled', MAIL.lapsed('cancelled', SUB)],
  ['06-trial-ends', MAIL.trialEnds('12 жовтня', '12', 290, SUB)],
  ['07-quiet', MAIL.deletionWarning(`${APP}/app`)],
] as const;

const browser = await chromium.launch();
for (const [name, letter] of letters) {
  const { html, text } = renderLetter(letter, { assetsBase: assets });
  writeFileSync(`${out}/${name}.html`, html);
  writeFileSync(`${out}/${name}.txt`, text);
  // Третій кадр — з вимкненими картинками: вимога спека, і єдиний спосіб
  // побачити, що лист читається, коли клієнт картинок не тягне.
  for (const [width, images] of [[600, true], [390, true], [600, false]] as const) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
    if (!images) await page.route('**/*.png', (r) => r.abort());
    // Саме goto, а не setContent: сторінка з about:blank не має права читати
    // file://, і PNG не вантажились би — тобто ми знімали б лист без картинок,
    // думаючи, що знімаємо з ними.
    await page.goto(`file://${out}/${name}.html`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${out}/${name}-${width}${images ? '' : '-noimg'}.png`, fullPage: true });
    await page.close();
  }
  console.log(`${name}: html, txt, 600, 390`);
}
await browser.close();
