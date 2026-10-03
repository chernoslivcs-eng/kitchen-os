// Пошукова база лендінгу, крок 1 (рішення власника 03.10): публічні сторінки
// (/, /terms, /privacy, /refund, /contacts) ділили один <title>Kitchen OS</title>
// з index.html і не мали ні <meta description>, ні OG/Twitter-тегів. /r/:id —
// окремий випадок: там теги вже підставляє сервер (vercel-handler.ts) до того,
// як HTML іде в браузер, бо прев'ю в Telegram/Slack читають <head> без JS.
//
// Тут — клієнтський варіант для решти: document.title і <head>-теги на
// mount, без react-helmet (єдина залежність заради шести рядків DOM-коду).
// Кожен керований тег позначений data-page-meta, щоб unmount прибирав рівно
// свої, не чіпаючи theme-color/manifest/preload-шрифти з index.html.
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

    const created: HTMLElement[] = [];
    for (const [attr, key, content] of metas) {
      const el = document.createElement('meta');
      el.setAttribute(attr, key);
      el.setAttribute('content', content);
      el.setAttribute('data-page-meta', '1');
      document.head.appendChild(el);
      created.push(el);
    }
    const canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    canonical.setAttribute('href', url);
    canonical.setAttribute('data-page-meta', '1');
    document.head.appendChild(canonical);
    created.push(canonical);

    return () => {
      document.title = prevTitle;
      for (const el of created) el.remove();
    };
  }, [title, description, image, type]);
}
