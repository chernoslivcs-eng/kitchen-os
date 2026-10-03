// Service Worker — простий cache-first для статики, mережа-first для навігацій,
// network-only для /v1/*. Робить встановлений PWA офлайн-запускабельним.
//
// Версія кешу береться з URL-параметра `?v=<build_id>`, який ми передаємо у
// navigator.serviceWorker.register('/sw.js?v=…'). Vite додає BUILD_ID через
// define в конфізі — кожен білд = нова URL = нова SW = нова кеш-версія = стара
// вибиваєтся в activate. Без цього після деплою PWA лишалась із застарілим
// spa.html.
//
// Пошукова база, крок 3: dist/index.html перейменовано на dist/spa.html
// (Vercel віддавав файл з таким ім'ям напряму на збіг шляху, ДО rewrites) —
// офлайн-заглушка SPA тепер під новим ім'ям.

const CACHE_PREFIX = 'kitchen-os-';
const CACHE_VERSION = CACHE_PREFIX + (new URL(self.location.href).searchParams.get('v') || 'dev');
const OFFLINE_FALLBACK = '/spa.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(['/', OFFLINE_FALLBACK, '/manifest.webmanifest', '/icon.svg'])
    )
  );
  self.skipWaiting();
});

// Лишаємо ДВІ версії: поточну й одну попередню.
//
// Раніше activate зносив усе, крім нової. Але skipWaiting + clients.claim
// означають, що нова SW перехоплює ВЖЕ ВІДКРИТІ вкладки — і разом із кешем
// зникали чанки, на які ті вкладки досі посилаються. Далі сторінка йшла по
// них у мережу й отримувала 404: саме так народився `vite:preloadError`,
// заради якого писався обробник у lib/preload-error.ts.
//
// Попередню впізнаємо за іменем: версія — це Date.now().toString(36) з білду
// (vite.config.ts). Такі рядки мають однакову довжину (вісім символів аж до
// 2059 року), а в base36 цифри йдуть перед літерами і за значенням, і в ASCII
// — тож звичайне сортування рядків збігається з хронологічним. Перевірено, а
// не припущено.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const ours = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    // Найсвіжіша з ЧУЖИХ (не поточної) — і є попередня.
    const previous = ours.filter((k) => k !== CACHE_VERSION).sort().pop();
    const keep = new Set([CACHE_VERSION]);
    if (previous) keep.add(previous);
    // Видаляємо лише СВОЇ: кеш під чужим іменем на цьому домені — не наш, щоб
    // його зносити. Раніше цикл ішов по всіх ключах поспіль.
    await Promise.all(ours.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
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
