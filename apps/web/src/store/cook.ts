// Пул-3: Cook Mode — поп-ап, не сторінка. Глобальний стор відкриття:
// будь-яка точка входу (стрічка, сторінка рецепта, журнал, банери) кличе
// open(...) — оверлей малюється поверх поточного екрана, «✕» просто закриває
// його без жодної навігації: людина лишається там, де була.

import { create } from 'zustand';
import type { Recipe } from '../api';

export interface CookOpenArgs {
  recipe: Recipe;
  recipeId?: string;
  // Сесія запуску: фініш пише session_id у cook_run і веде в неї показати
  // детерміноване «Списати продукти?».
  returnSessionId?: string | null;
  startAt?: number;
}

interface CookStore {
  args: CookOpenArgs | null;
  open: (args: CookOpenArgs) => void;
  close: () => void;
}

export const useCookStore = create<CookStore>((set) => ({
  args: null,
  open: (args) => set({ args }),
  close: () => set({ args: null }),
}));
