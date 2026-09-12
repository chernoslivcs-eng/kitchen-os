// Мобільний аудит 0912 · A (№46): сторінки — окремими чанками, гість на
// лендінгу не качає застосунок і адмінку. Після нового деплою старий HTML
// може попросити чанк, якого вже нема («Loading chunk failed»): один раз
// перезавантажуємось (мітка в sessionStorage, не в циклі), далі — помилка
// в ErrorBoundary, як будь-яка інша.
import { lazy, type ComponentType } from 'react';

const RELOAD_KEY = 'kos-chunk-reload';

export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() => load().catch((err: unknown) => {
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0); } catch { /* приватний режим */ }
    if (Date.now() - last > 60_000) {
      try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* приватний режим */ }
      window.location.reload();
      return new Promise<{ default: T }>(() => {});
    }
    throw err;
  }));
}
