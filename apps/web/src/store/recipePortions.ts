// Р3 (spec 18.09): один стан порцій на recipe_id — картка рецепта в стрічці
// і артефакт «Рецепт» читають/пишуть той самий запис, тож зміна в одному
// місці одразу видна в іншому. `null`/відсутній запис — без явного вибору,
// компонент сам підставляє r.sv (як і раніше локальним useState).
import { create } from 'zustand';

interface RecipePortionsStore {
  byRecipeId: Record<string, number>;
  setServings: (recipeId: string, value: number) => void;
}

export const useRecipePortionsStore = create<RecipePortionsStore>((set) => ({
  byRecipeId: {},
  setServings: (recipeId, value) => set((s) => ({ byRecipeId: { ...s.byRecipeId, [recipeId]: value } })),
}));

export function useRecipePortions(recipeId: string | undefined): [number | null, (next: number) => void] {
  const value = useRecipePortionsStore((s) => (recipeId ? s.byRecipeId[recipeId] ?? null : null));
  const setServings = useRecipePortionsStore((s) => s.setServings);
  return [value, (next: number) => { if (recipeId) setServings(recipeId, next); }];
}
