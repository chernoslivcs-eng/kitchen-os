import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/roles.css';
import './styles/reset.css';
import { App } from './App';
import { initTheme } from './theme';
import { initSentry } from './lib/sentry';
import { installKeyboardOffset } from './lib/keyboard-offset';
import { installPreloadErrorHandler } from './lib/preload-error';
import { captureSignupSource } from './lib/signup-source';

initTheme();
installKeyboardOffset();
// Стара вкладка після деплою просить чанк, якого вже немає — див. lib/preload-error.
installPreloadErrorHandler();
// Мітки джерела (utm_*, ref) забираємо з адреси ДО першого рендера: роутер
// може одразу повести далі (`<Navigate>`, ?next), і рядок запиту зникне. Тут, а
// не в Landing — мічене посилання може вести й на /share/…, і на /invite.
captureSignupSource(window.location.search);

// Реєструємо service worker лише в проді — у dev-режимі Vite HMR ламатиметься.
// ?v=<BUILD_ID> — кожен білд отримує нову URL реєстрації → нова SW → нова
// CACHE_VERSION усередині → activate чистить старий кеш.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`/sw.js?v=${__BUILD_ID__}`).catch(() => {/* silent */});
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Мобільний аудит 0912 · A (№50): Sentry — після першого кадру, окремим
// чанком (lib/sentry — фасад із чергою: падіння першого рендера не
// губиться, ErrorBoundary кладе його в чергу, і воно летить, щойно SDK тут).
const idle: (cb: () => void) => void = 'requestIdleCallback' in window
  ? (cb) => window.requestIdleCallback(cb, { timeout: 2000 })
  : (cb) => { window.setTimeout(cb, 300); };
idle(() => { void initSentry(); });
