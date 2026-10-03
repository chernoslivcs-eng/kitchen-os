// Прев'ю рецепта (/r/:id) для Telegram/Facebook/Twitter: регрес від пошукової
// бази Крок 1 (03.10) — index.html уже несе статичні og/twitter/canonical
// лендінгу, і стара injectOgTags() вставляла свої теги поряд, не прибираючи
// старі → на /r/:id у проді по двоє og:title/canonical, краулер бере ПЕРШИЙ
// (лендінгу), прев'ю рецепта показувало назву застосунку, не страви.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { injectOgTags } from '../src/vercel-handler.js';

// index.html (джерело, не dist/) — та сама структура head, що й прод-білд
// для мети; build лише додає <script>/<link rel=stylesheet>, яких ця функція
// не торкається.
const HTML = readFileSync(join(import.meta.dirname, '../../../apps/web/index.html'), 'utf-8');

const RECIPE = { title: 'Борщ із буряком', description: '40 хв · 4 порції', url: 'https://kitchen-os.app/r/0f3a8c2e-...uuid' };

describe('injectOgTags: /r/:id без дублів', () => {
  const html = injectOgTags(HTML, RECIPE);

  it('рівно один <title>, значення — назва рецепта', () => {
    const matches = html.match(/<title>[^<]*<\/title>/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(`<title>${RECIPE.title} · Kitchen OS</title>`);
  });

  it('рівно один og:title, значення — назва рецепта (не лендінгу)', () => {
    const matches = html.match(/<meta property="og:title"[^>]*>/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(matches[0]).toContain(`content="${RECIPE.title}"`);
    expect(matches[0]).not.toContain('Kitchen OS — асистент');
  });

  it('рівно один canonical, href — адреса рецепта', () => {
    const matches = html.match(/<link rel="canonical"[^>]*>/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(matches[0]).toContain(`href="${RECIPE.url}"`);
  });

  it('рівно один og:description, og:url, og:type і три twitter:* теги', () => {
    for (const tag of ['og:description', 'og:url', 'og:type']) {
      expect(html.match(new RegExp(`<meta property="${tag}"[^>]*>`, 'g')) ?? [], tag).toHaveLength(1);
    }
    for (const tag of ['twitter:card', 'twitter:title', 'twitter:description']) {
      expect(html.match(new RegExp(`<meta name="${tag}"[^>]*>`, 'g')) ?? [], tag).toHaveLength(1);
    }
  });

  it('og:type=article, twitter:card=summary (не website/summary_large_image лендінгу)', () => {
    expect(html).toContain('<meta property="og:type" content="article" />');
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
  });

  it('og:image і twitter:image не торкнуті — немає свого фото рецепта, лишається обкладинка лендінгу', () => {
    expect(html).toContain('<meta property="og:image" content="https://kitchen-os.app/landing/og-cover.jpg" />');
    expect(html).toContain('<meta name="twitter:image" content="https://kitchen-os.app/landing/og-cover.jpg" />');
  });

  it('description лендінгу замінено на опис рецепта, рівно один раз', () => {
    const matches = html.match(/<meta name="description"[^>]*>/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(matches[0]).toContain(`content="${RECIPE.description}"`);
  });

  it('escape: назва з лапками й амперсандом не ламає розмітку', () => {
    const esc = injectOgTags(HTML, { title: 'М\'ясо & картопля "по-домашньому"', description: 'desc', url: RECIPE.url });
    const titleTags = esc.match(/<meta property="og:title"[^>]*>/g) ?? [];
    expect(titleTags).toHaveLength(1);
    expect(titleTags[0]).toContain('&amp;');
    expect(titleTags[0]).toContain('&quot;');
    expect(titleTags[0]).not.toContain('"по-домашньому"'); // сирі лапки всередині content зламали б атрибут
  });
});
