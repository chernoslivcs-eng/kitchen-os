// Ліва шухляда. Нижнього бара більше немає: цілі, «ЗАРАЗ», готування, сесії
// й профіль живуть в одній поверхні, яка на телефоні висувається, а від 768
// стоїть постійно.
//
// Стор, а не локальний стан екрана: відкриває її «☰» в шапці — а шапка
// належить кожному екрану, тимчасом як сама навігація живе в каркасі один
// раз (App.tsx → Shell).

import { create } from 'zustand';

interface NavStore {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

export const useNavStore = create<NavStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
