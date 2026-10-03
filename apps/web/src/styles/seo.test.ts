// Пошукова база, крок 1 (03.10): /robots.txt і /sitemap.xml реально
// існували лише як назва — файлів у public/ не було, і catch-all rewrite
// vercel.json («усе, крім названих статичних файлів, → /index.html») не мав
// їх у винятках, тож обидва шляхи віддавали HTML лендінгу (хибна причина —
// не вигадана: robots.txt/sitemap.xml жодного разу не fetch'ились локально,
// тож grep по бандлу й ручний curl на localhost нічого не бачать; перевіряти
// можна лише по самому конфігу й файлах, які реально підуть у dist/).
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../..', import.meta.url));
const ROOT = join(WEB, '..', '..');

function rewrites(): { source: string; destination: string }[] {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as { rewrites: { source: string; destination: string }[] };
  return cfg.rewrites;
}

function spaCatchAll(): RegExp {
  // Той самий rewrite, що ловить усе й веде на /index.html — єдиний, чий
  // source компілюється з негативним lookahead-переліком винятків.
  const r = rewrites().find((x) => x.destination === '/index.html');
  if (!r) throw new Error('vercel.json: catch-all rewrite на /index.html не знайдено');
  // Vercel-паттерн — valid regex мінус leading "/"; source уже без прапорців.
  return new RegExp('^' + r.source.replace(/^\//, ''));
}

describe('robots.txt і sitemap.xml — реальні файли, не SPA-заглушка', () => {
  it('apps/web/public/robots.txt існує: Allow /, Disallow приватних шляхів, Sitemap', () => {
    const txt = readFileSync(join(WEB, 'public/robots.txt'), 'utf8');
    expect(txt).toMatch(/^User-agent: \*/m);
    expect(txt).toMatch(/^Allow: \/$/m);
    for (const path of ['/app', '/profile', '/admin', '/v1']) {
      expect(txt, `Disallow: ${path}`).toMatch(new RegExp(`^Disallow: ${path.replace('/', '\\/')}$`, 'm'));
    }
    expect(txt).toMatch(/^Sitemap: https:\/\/kitchen-os\.app\/sitemap\.xml$/m);
  });

  it('apps/web/public/sitemap.xml існує: лендінг + 4 юрсторінки, валідний XML', () => {
    const xml = readFileSync(join(WEB, 'public/sitemap.xml'), 'utf8');
    expect(xml).toMatch(/^<\?xml version="1\.0"/);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    for (const path of ['/', '/terms', '/privacy', '/refund', '/contacts']) {
      expect(xml, `<loc>https://kitchen-os.app${path}</loc>`).toContain(`<loc>https://kitchen-os.app${path}</loc>`);
    }
  });

  it('vercel.json: catch-all rewrite НЕ ловить robots.txt і sitemap.xml (вони йдуть як статичні файли)', () => {
    const re = spaCatchAll();
    expect(re.test('robots.txt'), `${re} не мусить ловити robots.txt`).toBe(false);
    expect(re.test('sitemap.xml'), `${re} не мусить ловити sitemap.xml`).toBe(false);
    // Контроль: той самий rewrite і далі ловить звичайну сторінку застосунку.
    expect(re.test('app'), `${re} мусить і далі ловити /app`).toBe(true);
  });

  it('файли в public/ потраплять у dist/ (vite копіює public як є) — ім\'я збігається з шляхом у sitemap/robots', () => {
    expect(() => statSync(join(WEB, 'public/robots.txt'))).not.toThrow();
    expect(() => statSync(join(WEB, 'public/sitemap.xml'))).not.toThrow();
  });
});

// Правка власника 03.10 (крок 1): боти прев'ю (TelegramBot,
// facebookexternalhit, Twitterbot, Slack, Google) JS не виконують — title/
// description/OG/canonical лендінгу мусять бути в СИРОМУ index.html, не
// підставлені usePageMeta() на mount (той самий HTML іде всім SPA-шляхам
// без curl -A Googlebot — живий доказ у PR, тут лише статична перевірка
// самого файлу).
describe('index.html: мета лендінгу — статично, без JS', () => {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');

  it('title і description — текст власника, дослівно', () => {
    expect(html).toContain('<title>Kitchen OS — асистент для домашньої кухні</title>');
    expect(html).toContain('<meta name="description" content="Асистент для домашньої кухні: знає, що у тебе вдома, пропонує, що приготувати, веде по кроках і сам веде список покупок. 7 днів безкоштовно, без картки." />');
  });

  it('заборонені фрази з брифу копі («памʼятає», «з того, що є») відсутні', () => {
    expect(html).not.toMatch(/памʼята/i);
    expect(html).not.toMatch(/з того,? що (вже )?є/i);
  });

  it('OG/Twitter: type=website, картинка й canonical — абсолютні https://kitchen-os.app', () => {
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toContain('<meta property="og:image" content="https://kitchen-os.app/landing/og-cover.jpg" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<link rel="canonical" href="https://kitchen-os.app/" />');
  });

  it('Landing.tsx більше не дублює ці теги через usePageMeta — статика і є її тегами', () => {
    const landing = readFileSync(join(WEB, 'src/pages/Landing/Landing.tsx'), 'utf8');
    expect(landing).not.toContain('usePageMeta');
  });
});
