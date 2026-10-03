// @vitest-environment jsdom
//
// Пошукова база, крок 1 (03.10, правка того ж дня): лендінгові title/
// description/OG/canonical тепер статичні в index.html (боти прев'ю JS не
// виконують). Хук більше не «створює й прибирає власні теги» — він
// ПІДМІНЯЄ те, що вже є (бо для будь-якої публічної сторінки в <head>
// завжди лежать лендінгові теги зі статики), і повертає старе значення на
// unmount; якщо тега справді нема — створює й прибирає, як і раніше.
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
  document.head.querySelectorAll('meta[name="description"], meta[property^="og:"], meta[name^="twitter:"], link[rel="canonical"]').forEach((el) => el.remove());
});

const meta = (name: string) => document.head.querySelector(`meta[name="${name}"]`)?.getAttribute('content');
const og = (prop: string) => document.head.querySelector(`meta[property="${prop}"]`)?.getAttribute('content');

describe('usePageMeta · тегів у <head> ще нема (ізольований компонент)', () => {
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
    expect(document.head.querySelector('meta[name="description"]')).toBeTruthy();
    await act(async () => { root!.unmount(); });
    root = undefined;

    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
    expect(document.head.contains(theme)).toBe(true);
    theme.remove();
  });
});

describe('usePageMeta · теги вже є (як на реальному index.html — лендінгові)', () => {
  function seedLandingTags() {
    const seeded: HTMLElement[] = [];
    const add = (tag: 'meta' | 'link', attrs: Record<string, string>) => {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      document.head.appendChild(el);
      seeded.push(el);
    };
    add('meta', { name: 'description', content: 'Опис лендінгу' });
    add('meta', { property: 'og:title', content: 'Лендінг' });
    add('link', { rel: 'canonical', href: 'https://kitchen-os.app/' });
    return () => seeded.forEach((el) => el.remove());
  }

  it('підміняє значення на mount, повертає лендінгове на unmount (а не видаляє тег)', async () => {
    const cleanupSeed = seedLandingTags();
    await mount({ title: 'Оферта · Kitchen OS', description: 'Умови використання' });

    expect(meta('description')).toBe('Умови використання');
    expect(og('og:title')).toBe('Оферта · Kitchen OS');
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${window.location.origin}${window.location.pathname}`);

    await act(async () => { root!.unmount(); });
    root = undefined;

    // Тег лишився — зі старим (лендінговим) значенням, не прибраний.
    expect(meta('description')).toBe('Опис лендінгу');
    expect(og('og:title')).toBe('Лендінг');
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://kitchen-os.app/');
    cleanupSeed();
  });
});
