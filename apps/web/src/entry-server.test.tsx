// @vitest-environment node
//
// Пошукова база, крок 2: без `@vitest-environment jsdom` (конвенція
// репозиторію — кожен тест просить jsdom сам, типове середовище тут node,
// grep -rn "vitest-environment" src/) — тут це саме потрібно: window/
// document відсутні, той самий шлях, що в scripts/prerender-bot-pages.tsx.
//
// Живцем перевірено (debug-сесія): щось у графі імпортів цього файлу —
// не Landing/LegalDocPage і не їхні прямі залежності, бо кожна з них
// окремо й разом імпортується й рендериться чисто — за певного порядку
// describe-блоків лишає на globalThis частковий `window` (є сам об'єкт,
// немає window.matchMedia), і useBreakpoint() падає замість обрати 'desk'.
// Сам prerender-bot-pages.tsx ЦЬОГО не зачіпає (окремий `node`-процес без
// vitest, живцем перевірено curl'ом) — явний reset тут лише для стабільності
// цього тестового файлу під vitest.
if ('window' in globalThis) delete (globalThis as { window?: unknown }).window;

import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Landing } from './pages/Landing/Landing';
import { LegalDocPage } from './pages/Legal/LegalDocPage';
import { LEGAL_DOCS, LEGAL_ROUTES, type LegalDocKey } from './lib/legal-docs';

function renderLanding(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/']}>
      <Landing />
    </MemoryRouter>,
  );
}

function renderLegal(doc: LegalDocKey, path: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <LegalDocPage doc={doc} />
    </MemoryRouter>,
  );
}

it('typeof window — undefined у цьому файлі (той самий шлях, що в prerender-bot-pages.tsx)', () => {
  expect(typeof window).toBe('undefined');
});

describe('/ — Landing без браузера', () => {
  const html = renderLanding();

  it('не падає й не містить <script', () => {
    expect(html).not.toContain('<script');
  });

  it('містить заголовок hero, ціну і «Як це працює»', () => {
    expect(html).toContain('Готувати вдома');
    expect(html).toContain('210 ₴');
    expect(html).toContain('Як це працює');
  });

  it('корінь позначено data-static — прапорець на СЕРВЕРІ підняний', () => {
    expect(html).toMatch(/data-static="/);
  });

  it('усі приклади fragSlot у знімку, не лише активний', () => {
    const slots = html.match(/class="_fragSlot_[^"]*"/g) ?? [];
    expect(slots.length).toBeGreaterThan(1);
  });
});

describe('Landing.module.css — правило, що лишає [data-reveal]/fragSlot видимими на сервері', () => {
  // import.meta.url + new URL(...) не годяться тут: vitest (threads-пул,
  // 2.x) за певних умов лишає в цьому ж worker'і глобали від jsdom-тесту,
  // запущеного раніше в тому самому процесі (window без matchMedia, URL,
  // що резолвить відносний шлях у http://localhost:3000/ замість file:) —
  // живцем перевірено. cwd — єдине надійне тут: vitest завжди стартує з
  // кореня пакета (apps/web), той самий корінь, що й у vite.config.ts.
  const css = readFileSync(join(process.cwd(), 'src/pages/Landing/Landing.module.css'), 'utf-8');

  it('має [data-static] [data-reveal] { opacity: 1 }', () => {
    expect(css).toMatch(/\.page\[data-static\]\s*\[data-reveal\]\s*\{[^}]*opacity:\s*1/);
  });

  it('має [data-static] .fragSlot { opacity: 1 }', () => {
    expect(css).toMatch(/\.page\[data-static\]\s*\.fragSlot\s*\{[^}]*opacity:\s*1/);
  });
});

describe('/terms /privacy /refund /contacts — юрсторінки без браузера', () => {
  for (const [doc, path] of Object.entries(LEGAL_ROUTES) as [LegalDocKey, string][]) {
    it(`${path}: не падає, без <script, перший змістовний абзац є`, () => {
      const html = renderLegal(doc, path);
      expect(html).not.toContain('<script');
      // Перший абзац кожного документа — те саме, що й усі інші реальні
      // абзаци цього документа: не заголовок, не порожній рядок. Markdown
      // **bold** рендериться як <strong> ПОСЕРЕДИНІ речення — звіряємо з
      // текстом без тегів, інакше літеральний підрядок з «**» ламається
      // на вставленому тегу. React-рендер ескейпить апостроф у &#x27; —
      // розкодовуємо назад, інакше рядок з «'» у джерелі не збіжиться.
      const plainText = html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'");
      const firstParagraph = LEGAL_DOCS[doc].md
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 20 && !l.startsWith('#'))!;
      expect(plainText).toContain(firstParagraph.replace(/[*_]/g, '').slice(0, 30));
    });
  }
});
