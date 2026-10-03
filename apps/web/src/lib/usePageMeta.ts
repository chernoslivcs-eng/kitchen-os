// Пошукова база лендінгу, крок 1 (рішення власника 03.10, правка того ж дня):
// боти прев'ю (TelegramBot, facebookexternalhit, Twitterbot, Slack, Google)
// JS не виконують — title/description/OG/canonical лендінгу тепер стоять
// СТАТИЧНО в apps/web/index.html (той самий файл на весь SPA, catch-all
// rewrite). Landing.tsx більше НЕ кличе цей хук: їй нічого підставляти,
// статичні теги вже її власні.
//
// Хук лишається для решти публічних сторінок (/terms, /privacy, /refund,
// /contacts) — їм потрібно перебити лендінгові теги з index.html на клієнті
// (title у вкладці, OG на випадок прямого шерингу посилання з уже
// відкритою сторінкою) і повернути як було при закритті. Тому — не
// «створити й прибрати», а «підмінити і відновити значення»: якщо тег уже є
// (а для title/description/OG на landing-маршруті він завжди є — прийшов
// зі статики), міняємо лише content і повертаємо старий на unmount; якщо
// тега нема (сторінка, якої цей index.html не передбачав), створюємо й
// прибираємо повністю.
//
// Крок 2 (03.10): computeMeta() винесено чистою функцією — той самий набір
// і порядок тегів рахує й DOM-хук тут (на клієнті), і
// scripts/prerender-bot-pages.tsx (SSR для ботів, рядком у HTML), щоб вони
// не розходились у двох місцях.
import { useEffect } from 'react';

export interface PageMeta {
  title: string;
  description: string;
  /** Абсолютний URL або шлях від кореня; типово — обкладинка лендінгу. */
  image?: string;
  type?: 'website' | 'article';
}

export interface MetaTag { attr: 'name' | 'property'; key: string; content: string }
export interface ComputedMeta { title: string; canonical: string; tags: MetaTag[] }

const DEFAULT_IMAGE = '/landing/og-cover.jpg';
const SITE_NAME = 'Kitchen OS';

export function computeMeta({ title, description, image = DEFAULT_IMAGE, type = 'website' }: PageMeta, origin: string, pathname: string): ComputedMeta {
  const url = origin + pathname;
  const absoluteImage = /^https?:\/\//.test(image) ? image : origin + image;
  return {
    title,
    canonical: url,
    tags: [
      { attr: 'name', key: 'description', content: description },
      { attr: 'property', key: 'og:title', content: title },
      { attr: 'property', key: 'og:description', content: description },
      { attr: 'property', key: 'og:url', content: url },
      { attr: 'property', key: 'og:type', content: type },
      { attr: 'property', key: 'og:image', content: absoluteImage },
      { attr: 'property', key: 'og:site_name', content: SITE_NAME },
      { attr: 'name', key: 'twitter:card', content: 'summary_large_image' },
      { attr: 'name', key: 'twitter:title', content: title },
      { attr: 'name', key: 'twitter:description', content: description },
      { attr: 'name', key: 'twitter:image', content: absoluteImage },
    ],
  };
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string): () => void {
  const existing = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (existing) {
    const prev = existing.getAttribute('content');
    existing.setAttribute('content', content);
    return () => { if (prev != null) existing.setAttribute('content', prev); };
  }
  const el = document.createElement('meta');
  el.setAttribute(attr, key);
  el.setAttribute('content', content);
  document.head.appendChild(el);
  return () => el.remove();
}

function upsertCanonical(href: string): () => void {
  const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (existing) {
    const prev = existing.getAttribute('href');
    existing.setAttribute('href', href);
    return () => { if (prev != null) existing.setAttribute('href', prev); };
  }
  const el = document.createElement('link');
  el.setAttribute('rel', 'canonical');
  el.setAttribute('href', href);
  document.head.appendChild(el);
  return () => el.remove();
}

export function usePageMeta(meta: PageMeta): void {
  const { title, description, image, type } = meta;
  useEffect(() => {
    const computed = computeMeta({ title, description, image, type }, window.location.origin, window.location.pathname);
    const prevTitle = document.title;
    document.title = computed.title;

    const restorers = computed.tags.map(({ attr, key, content }) => upsertMeta(attr, key, content));
    restorers.push(upsertCanonical(computed.canonical));

    return () => {
      document.title = prevTitle;
      for (const restore of restorers) restore();
    };
  }, [title, description, image, type]);
}
