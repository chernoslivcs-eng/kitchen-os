/// <reference types="vite/client" />

// Заповнюється Vite через `define:` у vite.config.ts. Короткий base36-хеш
// часу білду. Використовується у main.tsx для реєстрації sw.js?v=<id> —
// кожен deploy інвалідує кеш PWA.
declare const __BUILD_ID__: string;
