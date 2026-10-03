#!/usr/bin/env npx tsx
// Пошукова база, крок 2 (рішення власника 03.10): ботам прев'ю (Googlebot,
// bingbot, DuckDuckBot, YandexBot, facebookexternalhit, Twitterbot,
// TelegramBot, Slackbot, LinkedInBot, WhatsApp, Discordbot) — повний текст
// лендінгу й чотирьох юрсторінок БЕЗ виконання JS. Людям SPA лишається як є
// (гідратації тут нема взагалі — підхід власника, не renderToString: не
// треба ганятись за SSR-безпечністю useReveal/useScrollScene/відео).
//
// Playwright (справжній Chromium, той самий, що e2e-смоук) відкриває кожну
// з пʼяти публічних адрес проти prod-serve.ts ПІСЛЯ повного рендеру, знімає
// document.documentElement.outerHTML, вирізає <script> (щоб бот не виконав
// бандл поверх знімка — сам знімок статичний назавжди), пише в
// apps/web/dist/prerendered/<шлях>.html. vercel.json rewrite за заголовком
// User-Agent віддає ці файли ботам; усі інші User-Agent — звичайний
// index.html, без змін.
//
// reducedMotion: 'reduce' на знімальній сторінці прибирає проміжний стан
// transition під час самого захоплення (той самий гейт, що вже є в коді:
// Landing.module.css, @media (prefers-reduced-motion: reduce) глушить усі
// [data-reveal] в opacity:1 — без JS). Але це впливає лише на РЕНДЕР ПІД
// ЧАС ЗНІМАННЯ — статичний файл іде з лінком на той самий styles.css, і
// рендерить його бот своїми медіа-налаштуваннями, не моїми: Googlebot типово
// НЕ емулює prefers-reduced-motion, тож медіа-запит не спрацював би, а без
// <script> жоден data-reveal ніколи не отримає data-in. Тому атрибут
// data-reveal/data-reveal-x вирізається зі знятого HTML зовсім — без нього
// селектор `.page [data-reveal] { opacity: 0 }` ні на що не ляже, і текст
// лишається видимим незалежно від того, як бот рендерить CSS.
//
// Безпечно для прод-БД: під час білду тут немає apps/web/.env (лише
// .env.example у git) — pickRepo() у services/api/src/server.ts без PG_URL
// падає на InMemoryRepo, жодного рядка в прод не читає й не пише. /v1/auth/
// providers (єдиний fetch з Landing) — чисте відлуння env-змінних, без БД.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const BASE_URL = process.env.PRERENDER_BASE_URL ?? 'http://localhost:4173';
const PROD_ORIGIN = 'https://kitchen-os.app';
const OUT_DIR = resolve(import.meta.dirname, '../apps/web/dist/prerendered');

const ROUTES: Record<string, string> = {
  '/': 'index.html',
  '/terms': 'terms.html',
  '/privacy': 'privacy.html',
  '/refund': 'refund.html',
  '/contacts': 'contacts.html',
};

function stripScripts(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

/** Без <script> жоден [data-reveal] не отримає data-in — атрибут геть, щоб
 * `.page [data-reveal] { opacity: 0 }` не мав на що лягти. */
function stripRevealAttrs(html: string): string {
  return html.replace(/\s+data-reveal(-x)?="[^"]*"/g, '');
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();

  for (const [path, file] of Object.entries(ROUTES)) {
    await page.goto(BASE_URL + path, { waitUntil: 'networkidle' });
    // useScrollScene і подібні перераховують активний кадр на scroll/resize;
    // мить після networkidle — щоб усі ефекти першого рендеру встигли осісти.
    await page.waitForTimeout(300);
    const raw = await page.content();
    // localhost:4173 (prod-serve.ts) → справжній домен: usePageMeta()
    // рахує canonical/og:url/og:image від window.location.origin під час
    // знімання, і без цієї заміни вони лишились би на адресу стенда.
    const html = stripRevealAttrs(stripScripts(raw)).split(BASE_URL).join(PROD_ORIGIN);
    const outPath = join(OUT_DIR, file);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, html, 'utf8');
    console.log(`prerender-bot-pages: ${path} → dist/prerendered/${file} (${html.length} байт)`);
  }

  await browser.close();
}

await main();
