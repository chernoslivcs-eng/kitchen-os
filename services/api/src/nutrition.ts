// Раунд 5, крок Н1 (§4): БЖВ рецепта — з каталогу, рахує сервер (комора — pantry-view у домені).
// Модель у рецепті лишає своє `nu` як було; цей рядок — окремий, з джерелами.

import { resolveLabelToKey } from '@kitchen/catalog';
import { BY_KEY } from '@kitchen/catalog/seed';
import {
  recipeNutrition, resolveNutrition,
  type IngredientFacts, type RecipeNutrition, type PantryBatch, type HouseholdProduct, type Recipe, type Repo,
} from '@kitchen/domain';

/**
 * Що каталог знає про позицію: БЖВ/100 г, вага штуки, густина. `productLabel`
 * (етап 5) — `product + variant` продукту дому, коли інгредієнт зіставлений
 * із партією комори (не з вільною назвою рецепта — `resolveNutrition`,
 * packages/domain/nutrition.ts, пояснює чому саме ця форма): конкретніший
 * рядок бази, коли резолвер дав сильний збіг, виграє в узагальненого,
 * запеченого в позицію каталогу.
 */
export function catalogFacts(catalog_key: string | null | undefined, label?: string, productLabel?: string | null): IngredientFacts | null {
  const key = catalog_key ?? (label ? resolveLabelToKey(label) : null);
  const item = key ? BY_KEY.get(key) : undefined;
  const nutrition = resolveNutrition(item?.nutrition, productLabel);
  if (!nutrition) return null;
  return { nutrition, unit_weight: item?.unit_weight, density: item?.density };
}

/**
 * Рядок під інгредієнтами: Σ(кількість × БЖВ/100) / порції. `p` — партія
 * (ключ каталогу партії або її продукту, інакше за назвою), `n` — за назвою.
 */
export function recipeNutritionFor(recipe: Recipe, batches: Map<string, PantryBatch>, products: HouseholdProduct[]): RecipeNutrition | null {
  return recipeNutrition(recipe, (ing) => {
    if (ing.p) {
      const b = batches.get(ing.p);
      if (!b) return null;
      const prod = b.product_id ? products.find((p) => p.id === b.product_id) : undefined;
      const productLabel = prod ? [prod.product, prod.variant].filter(Boolean).join(' ') : null;
      return catalogFacts(b.catalog_key ?? prod?.catalog_key ?? null, b.label, productLabel);
    }
    return ing.n ? catalogFacts(null, ing.n) : null;
  });
}

/** Партії рецепта по id — і для власника, і для публічного перегляду. */
export async function loadRecipeBatches(repo: Pick<Repo, 'getBatch'>, recipe: Recipe): Promise<Map<string, PantryBatch>> {
  const out = new Map<string, PantryBatch>();
  for (const ing of recipe.ing) {
    if (!ing.p || out.has(ing.p)) continue;
    const b = await repo.getBatch(ing.p);
    if (b) out.set(ing.p, b);
  }
  return out;
}
