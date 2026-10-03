#!/usr/bin/env npx tsx
// Пошукова база, крок 2 (рішення власника 03.10, варіант «в»): ботам прев'ю
// (Googlebot, bingbot, DuckDuckBot, YandexBot, facebookexternalhit,
// Twitterbot, TelegramBot, Slackbot, LinkedInBot, WhatsApp, Discordbot) —
// повний текст лендінгу й чотирьох юрсторінок БЕЗ браузера взагалі. Крок 1
// (Playwright + prod-serve.ts) на Vercel падав: build-образ не має
// libnspr4.so для headless-chromium (vercel inspect --logs, 03.10) — крок 2
// прибирає залежність від Chromium повністю, рендер текстом через
// react-dom/server.renderToStaticMarkup.
//
// Чому не просто `import('./Landing')` під звичайним tsx: Landing.tsx й усі
// його сусіди тягнуть CSS-модулі (`import s from './Landing.module.css'`) —
// esbuild/tsx такий імпорт не розуміє. А класи там мусять збігатися з
// dist/assets/Landing-*.css буква в букву: саме на цих класах тримається
// `.page[data-static] [data-reveal] { opacity: 1 }` (Landing.module.css) —
// правило, що лишає текст видимим у знімку. Тому компоненти бандлимо через
// Vite SSR build (apps/web/src/entry-server.tsx, той самий vite.config.ts,
// той самий детермінований хеш postcss-modules, що й клієнтський build) —
// а не плодимо другу копію верстки чи фальшивий DOM.
//
// Хуки на window/matchMedia/IntersectionObserver/відео пишуть самі себе так,
// щоб на сервері просто НЕ виконатись: ефекти (useEffect/useLayoutEffect)
// renderToStaticMarkup не викликає взагалі (SSR без гідратації), а те
// небагато, що читає window/document У РЕНДЕРІ (VideoBubble: createPortal,
// SignInForm: читання URL для lazy useState) — під явним `typeof window
// === 'undefined'` / `typeof document === 'undefined'`, без заглушок.
//
// Безпечно для прод-БД: тут немає apps/web/.env (лише .env.example у git) —
// LegalDocPage/Landing нічого не фетчать під час самого рендеру (fetch —
// лише в click-хендлерах), а pickRepo() тут не викликається взагалі.
import { build } from 'vite';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { computeMeta } from '../apps/web/src/lib/usePageMeta.ts';

const execFileAsync = promisify(execFile);

// Рендер — окремим процесом ПРОСТОГО node, без tsx: tsx реєструє свій
// ESM-loader на весь процес (не лише на цей файл), а той форсує умову
// резолву "development" для пакетів з conditional exports (react-router)
// незалежно від process.env.NODE_ENV — react лишається production (читає
// NODE_ENV сам), react-router іде в development-чанк, і react-dom/server
// падає на чужому діспетчері (dispatcher.getOwner is not a function:
// суміш production react-dom/server + development react-router). Живцем
// перевірено: той самий bundle під голим `node` рендерить без помилки.
const WEB_ROOT = resolve(import.meta.dirname, '../apps/web');
const DIST = join(WEB_ROOT, 'dist');
const OUT_DIR = join(DIST, 'prerendered');
const SSR_OUT = join(WEB_ROOT, '.prerender-ssr-tmp');
const PROD_ORIGIN = 'https://kitchen-os.app';

type Manifest = Record<string, { file: string; css?: string[]; imports?: string[] }>;

/** css усіх чанків, які entry (і все, що він імпортує) тягне за собою —
 * саме так Landing/LegalDocPage лишаються без власного <link> в spa.html
 * (lazy route-чанк, App.tsx: lazyPage), а боту без JS інакше дістати нема як. */
function collectCss(manifest: Manifest, key: string, seen = new Set<string>()): string[] {
  if (seen.has(key)) return [];
  seen.add(key);
  const entry = manifest[key];
  if (!entry) return [];
  const css = [...(entry.css ?? [])];
  for (const imp of entry.imports ?? []) {
    if (imp === 'index.html') continue;
    css.push(...collectCss(manifest, imp, seen));
  }
  return [...new Set(css)];
}

function stripScriptsAndPreloads(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s*<link[^>]*rel="modulepreload"[^>]*>\n?/gi, '');
}

function cssLinks(files: string[]): string {
  return files.map((f) => `    <link rel="stylesheet" href="/${f}">`).join('\n');
}

/** Прибирає статику лендінгу (Крок 1, apps/web/index.html), яку inject-head
 * нижче підставляє заново під конкретну юрсторінку. На відміну від
 * services/api/src/vercel-handler.ts::injectOgTags (той старі теги НЕ
 * прибирає — дублі og/canonical на /r/:id у проді, знайдено під час цієї ж
 * роботи, окремий борг), тут видаляємо ПЕРЕД тим, як вставляти нові. */
function stripExistingMeta(head: string): string {
  return head
    .replace(/<title>[^<]*<\/title>\n?/i, '')
    .replace(/<meta name="description"[^>]*>\n?/i, '')
    .replace(/<meta property="og:[^"]+"[^>]*>\n?/gi, '')
    .replace(/<meta name="twitter:[^"]+"[^>]*>\n?/gi, '')
    .replace(/<link rel="canonical"[^>]*>\n?/i, '');
}

// head — лише вміст МІЖ <head> і </head> (regex-група в main(), сам
// wrapper додає assemble()) — вставляти нові теги треба дописуванням, не
// заміною "</head>": цього рядка в head нема, replace() тихо нічого не
// робить (саме так зникли title/og/canonical з /terms на першому прогоні).
function injectHeadMeta(head: string, title: string, description: string, canonical: string, image: string): string {
  const tags = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:site_name" content="Kitchen OS" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<link rel="canonical" href="${canonical}" />`,
  ].join('\n    ');
  return `${head}\n    ${tags}`;
}

function assemble(head: string, bodyHtml: string): string {
  return `<!doctype html>\n<html lang="uk">\n  <head>\n${head}\n  </head>\n  <body>\n    <div id="root">${bodyHtml}</div>\n  </body>\n</html>\n`;
}

async function main() {
  // Пошукова база, крок 3: dist/index.html перейменовано на dist/spa.html
  // (vercel-build.sh, ДО цього кроку) — Vercel віддавав файл на збіг шляху
  // РАНІШЕ, ніж дивився в rewrites, і бот-UA правило для «/» не встигало
  // спрацювати.
  const spaHtml = await readFile(join(DIST, 'spa.html'), 'utf-8');
  const headMatch = spaHtml.match(/<head>([\s\S]*?)<\/head>/i);
  if (!headMatch) throw new Error('prerender-bot-pages: dist/spa.html без <head> — білд фронта не пройшов?');
  const baseHead = stripScriptsAndPreloads(headMatch[1]!).trim();

  const manifest: Manifest = JSON.parse(await readFile(join(DIST, '.vite/manifest.json'), 'utf-8'));
  const landingCss = collectCss(manifest, 'src/pages/Landing/Landing.tsx');
  const legalCss = collectCss(manifest, 'src/pages/Legal/LegalDocPage.tsx');

  // SSR build entry-server.tsx — та сама верстка, що й у клієнта (ніякої
  // другої копії), той самий vite.config.ts і тому той самий хеш CSS-класів.
  await rm(SSR_OUT, { recursive: true, force: true });
  try {
    await build({
      root: WEB_ROOT,
      configFile: resolve(WEB_ROOT, 'vite.config.ts'),
      mode: 'production',
      logLevel: 'warn',
      build: {
        ssr: resolve(WEB_ROOT, 'src/entry-server.tsx'),
        outDir: '.prerender-ssr-tmp',
        write: true,
        emptyOutDir: true,
        minify: false,
      },
    });
    // Рендер самого дерева — у дочірньому процесі голого node (без tsx),
    // див. коментар вище. render-runner сам викликає всі п'ять рендерів і
    // віддає готовий результат одним JSON у stdout.
    const runnerPath = join(SSR_OUT, 'render-runner.mjs');
    await writeFile(runnerPath, RENDER_RUNNER_SRC, 'utf-8');
    const { stdout } = await execFileAsync('node', [runnerPath], { cwd: SSR_OUT, maxBuffer: 64 * 1024 * 1024 });
    const rendered = JSON.parse(stdout) as {
      landingHtml: string;
      legal: Record<string, { html: string; path: string; title: string; description: string }>;
    };

    await mkdir(OUT_DIR, { recursive: true });

    // / — head той самий, що в spa.html (мета/og/canonical лендінгу вже
    // там, Крок 1) + CSS lazy-чанку Landing, якого spa.html не лінкує.
    const landingHead = `${baseHead}\n${cssLinks(landingCss)}`;
    await writeFile(join(OUT_DIR, 'index.html'), assemble(landingHead, rendered.landingHtml), 'utf-8');
    console.log('prerender-bot-pages: / → dist/prerendered/index.html');

    for (const [doc, { html, path, title, description }] of Object.entries(rendered.legal)) {
      const computed = computeMeta({ title: `${title} · Kitchen OS`, description }, PROD_ORIGIN, path);
      const image = computed.tags.find((t) => t.key === 'og:image')!.content;
      let head = stripExistingMeta(baseHead);
      head = injectHeadMeta(head, computed.title, description, computed.canonical, image);
      head = `${head}\n${cssLinks(legalCss)}`;
      const file = `${doc}.html`;
      await writeFile(join(OUT_DIR, file), assemble(head, html), 'utf-8');
      console.log(`prerender-bot-pages: ${path} → dist/prerendered/${file}`);
    }
  } finally {
    await rm(SSR_OUT, { recursive: true, force: true });
  }
}

const RENDER_RUNNER_SRC = `
import { renderLandingHtml, renderLegalHtml, legalMeta, LEGAL_ROUTES } from './entry-server.js';
const legal = {};
for (const [doc, path] of Object.entries(LEGAL_ROUTES)) {
  const { title, description } = legalMeta(doc);
  legal[doc] = { html: renderLegalHtml(doc, path), path, title, description };
}
process.stdout.write(JSON.stringify({ landingHtml: renderLandingHtml(), legal }));
`;

await main();
