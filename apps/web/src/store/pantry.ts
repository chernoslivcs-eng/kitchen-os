// Пул-5 №5: лічильник комори в сайдбарі відставав від шапки — TabBar кешував
// кількість на 60с і не знав про «Застосувати». Той самий патерн, що
// useSessionStore: Feed сіпає bump після подій, які міняють комору
// (apply/undo картки), TabBar перечитує.

import { create } from 'zustand';

interface PantryState {
  version: number;
  bump: () => void;
}

export const usePantryStore = create<PantryState>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));
