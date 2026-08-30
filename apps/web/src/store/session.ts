// Правка №1: сесії живуть у сайдбарі — TabBar і Feed мають ділити знання
// «яка сесія активна» і «список посвіжішав». Мінімальний стор: активний id
// (ставить Feed) і version-лічильник (Feed сіпає після подій, TabBar
// перечитує список).

import { create } from 'zustand';

interface SessionState {
  activeSessionId: string | null;
  version: number;
  setActive: (id: string | null) => void;
  bump: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  activeSessionId: null,
  version: 0,
  setActive: (id) => set({ activeSessionId: id }),
  bump: () => set((s) => ({ version: s.version + 1 })),
}));
