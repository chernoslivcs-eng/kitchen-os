// Хотфікс 29.09. Sentry (kitchen-web, prod): `Unable to preload CSS for
// /assets/Icon-*.css`. Це подія Vite `vite:preloadError` — сторінка, відкрита
// ДО деплою, просить чанк зі старим хешем, якого на новій збірці вже немає.
// За два дні було чотири деплої, тож випадок не рідкісний; те саме дає обрив
// мережі на телефоні.
//
// Ліки прості: перезавантажити сторінку — свіжий index.html принесе свіжі
// імена чанків. Небезпека теж проста: якщо чанк не вантажиться з якоїсь
// СТАЛОЇ причини (зламаний деплой, блокувальник, мертва мережа),
// перезавантаження зациклиться. Тому мітка в sessionStorage: перезавантажуємо
// не частіше разу на хвилину, а другий випадок підряд показуємо людині й
// відправляємо в Sentry — далі це вже не «оновилось», а щось зламане.
import { captureClientIncident } from './sentry';

const KEY = 'kos_preload_reload_at';
/** Ближче цього вікна другий раз не перезавантажуємо. */
export const RELOAD_WINDOW_MS = 60_000;

const readLast = (): number => {
  try { return Number(sessionStorage.getItem(KEY) ?? 0) || 0; } catch { return 0; }
};
const writeLast = (at: number): void => {
  try { sessionStorage.setItem(KEY, String(at)); } catch { /* приватний режим */ }
};

/**
 * Рядок для людини малюємо голим DOM, а не через React.
 *
 * Навмисно: подія означає, що чанк НЕ завантажився, тобто застосунок цілком
 * може бути в напівзібраному стані — саме той момент, коли покладатись на
 * його ж рендер не варто. Тут потрібен найкоротший шлях до видимого тексту.
 */
function showBanner(text: string): void {
  if (document.getElementById('kos-preload-banner')) return;
  const el = document.createElement('div');
  el.id = 'kos-preload-banner';
  el.setAttribute('role', 'alert');
  el.textContent = text;
  el.style.cssText = [
    'position:fixed', 'left:50%', 'transform:translateX(-50%)', 'top:16px',
    'z-index:2147483647', 'max-width:calc(100vw - 32px)', 'box-sizing:border-box',
    'padding:12px 16px', 'border-radius:14px', 'background:#fff', 'color:#1a1c1e',
    'font:14px/1.4 system-ui,sans-serif', 'box-shadow:0 8px 32px rgba(26,28,30,.16)',
  ].join(';');
  document.body.appendChild(el);
}

export const PRELOAD_BANNER_TEXT = 'Застосунок оновився — перезавантаж сторінку.';

export interface PreloadErrorDeps {
  now?: () => number;
  reload?: () => void;
  banner?: (text: string) => void;
}

/** Повертає відписку — вона потрібна тестам, щоб слухачі не накопичувались. */
export function installPreloadErrorHandler(deps: PreloadErrorDeps = {}): () => void {
  const now = deps.now ?? (() => Date.now());
  const reload = deps.reload ?? (() => { window.location.reload(); });
  const banner = deps.banner ?? showBanner;

  const onPreloadError = (event: Event) => {
    // Без цього Vite кидає помилку далі, і вона летить у Sentry як падіння —
    // хоч ми її щойно обробили.
    event.preventDefault();

    const at = now();
    if (at - readLast() < RELOAD_WINDOW_MS) {
      // Другий раз за хвилину — перезавантаження не допомогло. Далі крутити
      // його означало б зациклити людину на білому екрані.
      captureClientIncident('chunk-preload-failed', {
        payload: String((event as unknown as { payload?: unknown }).payload ?? ''),
        since_last_reload_ms: at - readLast(),
      });
      banner(PRELOAD_BANNER_TEXT);
      return;
    }
    writeLast(at);
    reload();
  };

  window.addEventListener('vite:preloadError', onPreloadError);
  return () => window.removeEventListener('vite:preloadError', onPreloadError);
}
