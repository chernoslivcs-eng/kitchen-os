// Пошукова база, крок 2 (renderToStaticMarkup без браузера): єдина точка
// входу, яку scripts/prerender-bot-pages.tsx бандлить через Vite у режимі
// SSR (build.ssr) — той самий vite.config.ts, той самий postcss-modules
// хеш класів, що й у звичайному клієнтському build. MemoryRouter — без
// window/document, безпечний у Node; useLocation/useNavigate усередині
// Landing/LegalDocPage інакше впали б без Router-контексту.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Landing } from './pages/Landing/Landing';
import { LegalDocPage } from './pages/Legal/LegalDocPage';
import { LEGAL_DOCS, LEGAL_ROUTES, type LegalDocKey } from './lib/legal-docs';

export { LEGAL_ROUTES };
export type { LegalDocKey };

// Заголовок/опис — для computeMeta() в самому скрипті (чистий модуль, без
// ?raw/CSS-імпортів, його tsx читає напряму, без Vite). md-тіло документа
// тут не потрібне — воно вже в рендері нижче.
export function legalMeta(doc: LegalDocKey): { title: string; description: string } {
  const { title, description } = LEGAL_DOCS[doc];
  return { title, description };
}

export function renderLandingHtml(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/']}>
      <Landing />
    </MemoryRouter>,
  );
}

export function renderLegalHtml(doc: LegalDocKey, path: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <LegalDocPage doc={doc} />
    </MemoryRouter>,
  );
}
