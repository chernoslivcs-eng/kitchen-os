// UX9-03: «модель показує пальцем {"p":"p12"}» — так задумувалось, а в
// реальності recipe_gen отримував голі UUID (36 символів) і мусив переписувати
// їх у рецепт. Один зісковзнувший рядок — і в слоті «паста» id ковбаси, а
// вморожування назв (QA9-01) впевнено підписує помилку: продукт вчить варити
// фует до аль денте. Тепер модель бачить ТІЛЬКИ p1..pN, а переклад в обидва
// боки — детермінований код.

import type { PantryBatch, Recipe } from './types.js';

export interface PantryAliasMap {
  toAlias: Map<string, string>;   // uuid → p1
  toId: Map<string, string>;      // p1 → uuid
}

export function buildAliasMap(batches: PantryBatch[]): PantryAliasMap {
  const toAlias = new Map<string, string>();
  const toId = new Map<string, string>();
  let n = 0;
  for (const b of batches) {
    if (b.state === 'depleted') continue;   // модель бачить тільки живі партії
    n += 1;
    const alias = `p${n}`;
    toAlias.set(b.id, alias);
    toId.set(alias, b.id);
  }
  return { toAlias, toId };
}

// Модельний вихід → справжні id. Невідомий аліас (моделі привиділось) — дроп
// p: чесне «не з комори» замість фантомного вказівника, який потім хтось
// спише з комори.
export function unaliasRecipeIds(recipe: Recipe, toId: Map<string, string>): Recipe {
  return {
    ...recipe,
    ing: recipe.ing.map((ing) => {
      if (!ing.p) return { ...ing };
      const id = toId.get(ing.p);
      if (id) return { ...ing, p: id };
      const { p: _drop, ...rest } = ing;
      return { ...rest };
    }),
  };
}

// Базовий рецепт у edit-контекст: справжні id → аліаси (модель ніколи не
// бачить UUID). Партія вже не в коморі — дроп p, n лишається (вморожена назва).
export function aliasRecipeIds(recipe: Recipe, toAlias: Map<string, string>): Recipe {
  return {
    ...recipe,
    ing: recipe.ing.map((ing) => {
      if (!ing.p) return { ...ing };
      const alias = toAlias.get(ing.p);
      if (alias) return { ...ing, p: alias };
      const { p: _drop, ...rest } = ing;
      return { ...rest };
    }),
  };
}
