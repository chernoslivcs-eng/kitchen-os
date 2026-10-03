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
import { useEffect } from 'react';

export interface PageMeta {
  title: string;
  description: string;
  /** Абсолютний URL або шлях від кореня; типово — обкладинка лендінгу. */
  image?: string;
  type?: 'website' | 'article';
}

const DEFAULT_IMAGE = '/landing/og-cover.jpg';
const SITE_NAME = 'Kitchen OS';

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

export function usePageMeta({ title, description, image = DEFAULT_IMAGE, type = 'website' }: PageMeta): void {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;

    const url = window.location.origin + window.location.pathname;
    const absoluteImage = /^https?:\/\//.test(image) ? image : window.location.origin + image;

    const metas: Array<[attr: 'name' | 'property', key: string, content: string]> = [
      ['name', 'description', description],
      ['property', 'og:title', title],
      ['property', 'og:description', description],
      ['property', 'og:url', url],
      ['property', 'og:type', type],
      ['property', 'og:image', absoluteImage],
      ['property', 'og:site_name', SITE_NAME],
      ['name', 'twitter:card', 'summary_large_image'],
      ['name', 'twitter:title', title],
      ['name', 'twitter:description', description],
      ['name', 'twitter:image', absoluteImage],
    ];

    const restorers = metas.map(([attr, key, content]) => upsertMeta(attr, key, content));
    restorers.push(upsertCanonical(url));

    return () => {
      document.title = prevTitle;
      for (const restore of restorers) restore();
    };
  }, [title, description, image, type]);
}
