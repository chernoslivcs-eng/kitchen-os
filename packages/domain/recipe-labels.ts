// QA9-01: назви інгредієнтів вморожуються в payload у момент генерації.
//
// До цього рендер (стрічка, Cook Mode) резолвив `ing.p` → назву по ЖИВІЙ
// коморі: партію списали після готування чи через intake_diff — і рецепт
// показував «з комори» в інгредієнтах та «Інгредієнт» у кроках (скріни
// Пилипа з тостом). Рецепт — незмінний документ: `p` лишається пальцем на
// партію для списання, а `n` — назвою для людини, записаною назавжди.

import type { PantryBatch, Recipe } from './types.js';

export function resolveRecipeLabels(recipe: Recipe, batches: PantryBatch[]): Recipe {
  const byId = new Map(batches.map((b) => [b.id, b.label]));
  return {
    ...recipe,
    ing: recipe.ing.map((ing) => {
      if (!ing.p || ing.n) return { ...ing };
      const label = byId.get(ing.p);
      return label ? { ...ing, n: label } : { ...ing };
    }),
  };
}
