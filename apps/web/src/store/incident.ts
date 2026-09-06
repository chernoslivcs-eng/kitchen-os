// Крок Е1: стани, про які треба сказати смугою, а не тостом.
//
// Живуть у сторі, бо приходять із будь-якого запиту (`api.req`), а показує їх
// каркас над колонкою. Три штуки, і кожна знімається сама:
//   401 — поки людина не зайшла знову;
//   429 — поки не мине час із Retry-After;
//   офлайн — поки не повернулась мережа.

import { create } from 'zustand';

interface IncidentStore {
  /** Сесія протухла в живому запиті. Написане в полі НЕ чіпаємо — це обіцянка стану. */
  authExpired: boolean;
  /** Час (мс), коли ліміт зніметься. null — ліміту немає. */
  throttledUntil: number | null;
  /** Скільки секунд ліміт тривав від початку — щоб смужка стікала з правильної частки. */
  throttledFor: number;
  offline: boolean;

  setAuthExpired: (v: boolean) => void;
  setThrottled: (seconds: number) => void;
  clearThrottled: () => void;
  setOffline: (v: boolean) => void;
}

export const useIncidentStore = create<IncidentStore>((set, get) => ({
  authExpired: false,
  throttledUntil: null,
  throttledFor: 0,
  offline: false,

  setAuthExpired: (authExpired) => set({ authExpired }),
  setThrottled: (seconds) => {
    const until = Date.now() + seconds * 1000;
    // Довший ліміт перебиває коротший: якщо два запити впіймали 429, лишається
    // той час, коли справді можна буде знову.
    if ((get().throttledUntil ?? 0) > until) return;
    set({ throttledUntil: until, throttledFor: seconds });
  },
  clearThrottled: () => set({ throttledUntil: null, throttledFor: 0 }),
  setOffline: (offline) => set({ offline }),
}));
