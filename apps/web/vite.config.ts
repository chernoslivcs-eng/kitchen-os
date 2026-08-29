import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Дев-режим: Vite на :5173, API-сервер (@kitchen/api) на :3000. Проксі однакова
// на всі /v1/* — cookie 'kos' лягає на 5173, magic-link теж «повертається» сюди
// (треба, щоб APP_URL у .env бекенду вказував на 5173).
//
// BUILD_ID — короткий хеш часу білду. Використовується у SW registration URL
// (/sw.js?v=<id>) щоб кожен deploy інвалідував старий кеш PWA.
const BUILD_ID = Date.now().toString(36);

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': {
        target: process.env.API_URL ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
