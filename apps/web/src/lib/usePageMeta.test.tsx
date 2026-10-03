// @vitest-environment jsdom
//
// Пошукова база, крок 1 (03.10): document.title і <head>-теги на mount,
// прибрані на unmount так, щоб theme-color/manifest/preload-шрифти з
// index.html лишились неторканими (лише [data-page-meta] під контролем).
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { usePageMeta, type PageMeta } from './usePageMeta';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function Page(props: PageMeta) {
  usePageMeta(props);
  return <div>сторінка</div>;
}

async function mount(props: PageMeta) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<Page {...props} />); });
}

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove();
  root = undefined;
  document.title = '';
});

const meta = (name: string) => document.head.querySelector(`meta[name="${name}"]`)?.getAttribute('content');
const og = (prop: string) => document.head.querySelector(`meta[property="${prop}"]`)?.getAttribute('content');

describe('usePageMeta', () => {
  it('ставить title, description і OG/Twitter', async () => {
    await mount({ title: 'Заголовок', description: 'Опис сторінки' });
    expect(document.title).toBe('Заголовок');
    expect(meta('description')).toBe('Опис сторінки');
    expect(og('og:title')).toBe('Заголовок');
    expect(og('og:description')).toBe('Опис сторінки');
    expect(og('og:type')).toBe('website');
    expect(meta('twitter:card')).toBe('summary_large_image');
  });

  it('картинка за замовчуванням — обкладинка лендінгу, абсолютним URL', async () => {
    await mount({ title: 'Т', description: 'О' });
    expect(og('og:image')).toBe(`${window.location.origin}/landing/og-cover.jpg`);
  });

  it('canonical — origin + pathname, без query/hash', async () => {
    await mount({ title: 'Т', description: 'О' });
    const href = document.head.querySelector('link[rel="canonical"]')?.getAttribute('href');
    expect(href).toBe(`${window.location.origin}${window.location.pathname}`);
  });

  it('unmount прибирає рівно свої теги, чужі (theme-color) не чіпає', async () => {
    const theme = document.createElement('meta');
    theme.setAttribute('name', 'theme-color');
    theme.setAttribute('content', '#eef0f1');
    document.head.appendChild(theme);

    await mount({ title: 'Т', description: 'О' });
    expect(document.head.querySelectorAll('[data-page-meta]').length).toBeGreaterThan(0);
    await act(async () => { root!.unmount(); });
    root = undefined;

    expect(document.head.querySelectorAll('[data-page-meta]').length).toBe(0);
    expect(document.head.contains(theme)).toBe(true);
    theme.remove();
  });
});
