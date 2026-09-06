/// <reference types="vite/client" />

// Заповнюється Vite через `define:` у vite.config.ts. Короткий base36-хеш
// часу білду. Використовується у main.tsx для реєстрації sw.js?v=<id> —
// кожен deploy інвалідує кеш PWA.
declare const __BUILD_ID__: string;

// Крок О1б: реліз для Sentry — той самий коміт, що і в лямбді. Порожній рядок
// у дев-режимі: локальний білд не має релізу й не має його вигадувати.
declare const __SENTRY_RELEASE__: string;
