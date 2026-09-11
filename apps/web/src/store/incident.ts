// Крок Е1: стани, про які треба сказати смугою, а не тостом.
//
// Живуть у сторі, бо приходять із будь-якого запиту (`api.req`), а показує їх
// каркас над колонкою. Три штуки, і кожна знімається сама:
//   401 — поки людина не зайшла знову;
//   429 — поки не мине час із Retry-After;
//   офлайн — поки не повернулась мережа.

import { create } from 'zustand';
import { loadUnsavedRun, type UnsavedRun } from '../lib/cook-session';

interface IncidentStore {
  /** Сесія протухла в живому запиті. Написане в полі НЕ чіпаємо — це обіцянка стану. */
  authExpired: boolean;
  /** Час (мс), коли ліміт зніметься. null — ліміту немає. */
  throttledUntil: number | null;
  /** Скільки секунд ліміт тривав від початку — щоб смужка стікала з правильної частки. */
  throttledFor: number;
  /**
   * Етап 3: ЯКИЙ ліміт — з поля `kind` у тілі 429. Необовʼязкове: старий сервер
   * його не шле, і тоді смуга лишається загальною («дай хвилину наздогнати»).
   */
  throttledKind: string | null;
  offline: boolean;
  /**
   * Етап 3: рядок стану дії змонтований (стрічка). Поки він є, смуги ліміту
   * й мережі не дублюють його — на стрічці за ці два стани відповідає рядок.
   * Сесія лишається смугою скрізь: це не стан дії, а стан входу.
   */
  actionRowMounted: boolean;
  /** Етап 5 (п.6): готування, яке не записалось, — смуга з «Повторити». */
  unsavedCook: UnsavedRun | null;

  setAuthExpired: (v: boolean) => void;
  setThrottled: (seconds: number, kind?: string | null) => void;
  clearThrottled: () => void;
  setOffline: (v: boolean) => void;
  setActionRowMounted: (v: boolean) => void;
  setUnsavedCook: (run: UnsavedRun | null) => void;
}

export const useIncidentStore = create<IncidentStore>((set, get) => ({
  authExpired: false,
  throttledUntil: null,
  throttledFor: 0,
  throttledKind: null,
  offline: false,
  actionRowMounted: false,
  unsavedCook: loadUnsavedRun(),

  setAuthExpired: (authExpired) => set({ authExpired }),
  setThrottled: (seconds, kind = null) => {
    const until = Date.now() + seconds * 1000;
    // Довший ліміт перебиває коротший: якщо два запити впіймали 429, лишається
    // той час, коли справді можна буде знову.
    if ((get().throttledUntil ?? 0) > until) return;
    set({ throttledUntil: until, throttledFor: seconds, throttledKind: kind });
  },
  clearThrottled: () => set({ throttledUntil: null, throttledFor: 0, throttledKind: null }),
  setOffline: (offline) => set({ offline }),
  setActionRowMounted: (actionRowMounted) => set({ actionRowMounted }),
  setUnsavedCook: (unsavedCook) => set({ unsavedCook }),
}));
