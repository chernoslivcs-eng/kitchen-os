// Service Worker — простий cache-first для статики, mережа-first для навігацій,
// network-only для /v1/*. Робить встановлений PWA офлайн-запускабельним.
//
// Версія кешу — вручну: при зміні index.html/JS-бандлу міняємо CACHE_VERSION
// щоб примусово інвалідувати старий кеш. Vite додає хеш до assets, тому вони
// самі версіонуються — але sw.js кешує їх під однією назвою.

const CACHE_VERSION = 'kitchen-os-v1';
const OFFLINE_FALLBACK = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(['/', OFFLINE_FALLBACK, '/manifest.webmanifest', '/icon.svg'])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Не чіпаємо: /v1/* (API, потрібна свіжа відповідь + auth cookies),
  // POST/PATCH/DELETE, cross-origin (шрифти йдуть повз).
  if (req.method !== 'GET') return;
  if (url.pathname.startsWith('/v1/')) return;
  if (url.origin !== self.location.origin) return;

  // Навігаційні запити (юзер вставив URL/натиснув reload) — Network first, з
  // fallback на кешовану index.html якщо мережі нема.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_FALLBACK).then((r) => r || new Response('Offline', { status: 503 })))
    );
    return;
  }

  // Асети (/assets/*, /icon.svg тощо) — Cache first із оновленням у фоні.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => cached || new Response('Offline', { status: 503 }));
      return cached || network;
    })
  );
});
