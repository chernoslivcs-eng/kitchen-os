import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/reset.css';
import { App } from './App';
import { initTheme } from './theme';

initTheme();

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
