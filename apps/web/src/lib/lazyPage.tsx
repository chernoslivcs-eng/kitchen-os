// Мобільний аудит 0912 · A (№46): сторінки — окремими чанками, гість на
// лендінгу не качає застосунок і адмінку. Після деплою старий HTML може
// попросити чанк, якого вже нема; при поганій мережі імпорт теж падає.
//
// Аудит 0913 C.3 (рішення власника): повторного import() НЕ робимо — module
// map памʼятає відмову, повтор того самого специфікатора відкидається без
// мережі. Замість цього:
//   · офлайн (navigator.onLine === false) — не перезавантажуємо: кидаємо
//     помилку з міткою ChunkOfflineError, ErrorBoundary показує «Нема мережі»
//     з «Повторити» (= reload);
//   · онлайн — reload не частіше разу на 60 с (мітка в sessionStorage) і не
//     більше разу за життя сторінки, якщо storage недоступний (iOS
//     «блокувати всі cookie» кидає на доступі — раніше це давало нескінченний
//     reload); проміс висить, Suspense тримає тихе поле до перезавантаження;
//   · далі — помилка в ErrorBoundary, як будь-яка інша.
import { lazy, type ComponentType } from 'react';

const RELOAD_KEY = 'kos-chunk-reload';
const RELOAD_WINDOW_MS = 60_000;

/** Чанк не завантажився, бо мережі нема. Не падіння коду — Sentry його не рахує як crash. */
export class ChunkOfflineError extends Error {
  override readonly name = 'ChunkOfflineError';
  constructor(cause: unknown) {
    super('Нема мережі: частина застосунку не завантажилась');
    this.cause = cause;
  }
}

export interface LazyDeps {
  reload: () => void;
  now: () => number;
  online: () => boolean;
}
const REAL: LazyDeps = {
  reload: () => window.location.reload(),
  now: () => Date.now(),
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
};

/** Чи вже перезавантажувались у цьому житті сторінки — запобіжник без storage. */
let reloadedHere = false;
/** Тільки для тестів. */
export function __resetLazyPage(): void { reloadedHere = false; }

function lastReload(): number | null {
  try { return Number(sessionStorage.getItem(RELOAD_KEY) ?? 0); } catch { return null; }
}
function markReload(now: number): void {
  try { sessionStorage.setItem(RELOAD_KEY, String(now)); } catch { /* без storage тримає reloadedHere */ }
}

export async function loadWithRecovery<T>(load: () => Promise<T>, deps: LazyDeps = REAL): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (!deps.online()) throw new ChunkOfflineError(err);
    const last = lastReload();
    const may = last === null ? !reloadedHere : deps.now() - last > RELOAD_WINDOW_MS;
    if (may) {
      reloadedHere = true;
      markReload(deps.now());
      deps.reload();
      return new Promise<T>(() => {});
    }
    throw err;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- baseline #1
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() => loadWithRecovery(load));
}
