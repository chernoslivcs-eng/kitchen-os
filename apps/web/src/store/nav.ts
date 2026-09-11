// Навігація — одна поверхня в чотирьох контейнерах (етап 6a, Responsive R0–R1,
// Screens D5 · 390):
//   <768      нижній бар із пʼяти цілей + шухляда 300 з кнопки «панель» у шапці
//   768–1023  рейка 64 постійно; та сама кнопка вгорі рейки розсуває шухляду 300
//   ≥1024     рейка 60 ⇄ сайдбар 256 — одна кнопка, стан запамʼятовується
//   ≥1920     сайдбар за замовчуванням (є місце)
//
// `open` — шухляда поверх контенту (<1024). `expanded` — сайдбар замість рейки
// (≥1024); він не накриває, а зсуває контент (body.nav-expanded → padding).
// Стор, а не локальний стан: кнопка живе і в рейці, і в шапці кожного екрана,
// а сама навігація — у каркасі один раз.

import { create } from 'zustand';

const KEY = 'kos-nav-expanded';
export const WIDE_DEFAULT = 1920;

function readExpanded(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* приватний режим */ }
  return typeof window !== 'undefined' && window.innerWidth >= WIDE_DEFAULT;
}

interface NavStore {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  toggleExpanded: () => void;
}

export const useNavStore = create<NavStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  expanded: readExpanded(),
  setExpanded: (expanded) => {
    try { localStorage.setItem(KEY, expanded ? '1' : '0'); } catch { /* ок */ }
    set({ expanded });
  },
  toggleExpanded: () => set((s) => {
    try { localStorage.setItem(KEY, s.expanded ? '0' : '1'); } catch { /* ок */ }
    return { expanded: !s.expanded };
  }),
}));
