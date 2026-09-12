import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// Дев-режим: Vite на :5173, API-сервер (@kitchen/api) на :3000. Проксі однакова
// на всі /v1/* — cookie 'kos' лягає на 5173, magic-link теж «повертається» сюди
// (треба, щоб APP_URL у .env бекенду вказував на 5173).
//
// BUILD_ID — короткий хеш часу білду. Використовується у SW registration URL
// (/sw.js?v=<id>) щоб кожен deploy інвалідував старий кеш PWA.
const BUILD_ID = Date.now().toString(36);

// Крок О1б. Реліз спільний із лямбдою — його рахує scripts/vercel-build.sh і
// передає сюди через SENTRY_RELEASE (коміт, якщо деплой із git-інтеграції;
// id деплою, якщо з CLI — тоді коміта Vercel просто не знає).
//
// Порожній реліз — нормальний стан: склеювання стека з мапою тримається на
// debug id, який плагін вшиває сам, а реліз потрібен лише для групування.
const RELEASE = process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || '';
// Умова — ТІЛЬКИ токен. Спершу тут стояло `token && RELEASE`, і перший же
// деплой із CLI пройшов повз вивантаження при цілком наявному токені.
// Немає токена — плагін не підключається взагалі: локальна збірка й preview
// не мають ні падати, ні мовчки лізти в чужу організацію.
const SENTRY_UPLOAD = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default defineConfig({
  build: {
    // Сорсмепи потрібні, щоб стек у Sentry був про наш код, а не про
    // `chunk-A1B2.js:1:48210`. Плагін нижче вивантажує їх і ВИДАЛЯЄ з dist —
    // публікувати сорсмепи разом зі збіркою ми не хочемо.
    sourcemap: SENTRY_UPLOAD ? true : false,
    rollupOptions: {
      output: {
        // П.8 pre-deploy: react-рантайм окремим чанком — кешується між
        // деплоями, бо міняється рідше за код продукту.
        manualChunks: {
          // 0912 A: react-dom/client — окремий вхід пакета, без нього ядро react-dom
          // лягало в index (536 kB джерел), а «вендорний» чанк мав 52 kB.
          'react-vendor': ['react', 'react-dom', 'react-dom/client', 'react-router-dom'],
        },
      },
    },
  },
  plugins: [
    react(),
    ...(SENTRY_UPLOAD ? [sentryVitePlugin({
      // Організація в регіоні EU — API там свій, дефолтний sentry.io відповів
      // би 404 на вивантаження.
      url: process.env.SENTRY_URL ?? 'https://de.sentry.io',
      org: process.env.SENTRY_ORG ?? 'kitchen-os-le',
      project: process.env.SENTRY_PROJECT ?? 'kitchen-web',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      ...(RELEASE ? { release: { name: RELEASE } } : {}),
      sourcemaps: { filesToDeleteAfterUpload: ['apps/web/dist/**/*.map', 'dist/**/*.map'] },
      telemetry: false,
      // Збірка не має падати через Sentry: якщо вивантаження не вдалось,
      // деплой усе одно має поїхати — просто стеки будуть неточні.
      errorHandler: (err) => { console.warn('sentry: сорсмепи не вивантажились —', err.message); },
    })] : []),
  ],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __SENTRY_RELEASE__: JSON.stringify(RELEASE),
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
