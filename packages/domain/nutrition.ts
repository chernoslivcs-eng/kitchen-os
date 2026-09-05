// Раунд 5, крок Н1: ккал з БЖВ одним правилом на весь моноліт, санітарна
// перевірка рядка й підрахунок рецепта з інгредієнтів.
//
// Ккал не зберігаються ніде: каталог тримає protein/fat/carbs на 100 г і
// джерело (usda / ciqual / estimate), усе інше — похідне. Так число не
// розʼїжджається між сідом, коморою й рецептом.

import type { Nutrition } from '@kitchen/catalog';

export type { Nutrition, NutritionSource } from '@kitchen/catalog';

/** 4-4-9, округлення до цілого. */
export function kcalOf(n: { protein: number; fat: number; carbs: number }): number {
  return Math.round(n.protein * 4 + n.carbs * 4 + n.fat * 9);
}

export const isEstimate = (n: { source: string }): boolean => n.source === 'estimate';

/**
 * Санітарна перевірка одного рядка: макро з клітковиною не більше 100 г на
 * 100 г продукту, жодного відʼємного числа, ккал у межах 0–900 (чистий жир —
 * 900). Повертає опис порушення або null.
 */
export function nutritionIssue(n: Nutrition): string | null {
  const vals: [string, number | undefined][] = [
    ['protein', n.protein], ['fat', n.fat], ['carbs', n.carbs], ['fiber', n.fiber], ['sugars', n.sugars], ['sodium_mg', n.sodium_mg],
  ];
  for (const [k, v] of vals) {
    if (v === undefined) continue;
    if (!Number.isFinite(v)) return `${k}: не число`;
    if (v < 0) return `${k}: відʼємне (${v})`;
  }
  const macro = n.protein + n.fat + n.carbs + (n.fiber ?? 0);
  if (macro > 100) return `білки+жири+вуглеводи+клітковина = ${round1(macro)} г > 100`;
  const kcal = kcalOf(n);
  if (kcal > 900) return `ккал 4-4-9 = ${kcal} > 900`;
  return null;
}

// ----- рецепт -----------------------------------------------------------------

export interface RecipeIngLike { p?: string; n?: string; v?: number; u?: string }

/** Що резолвер знає про інгредієнт: БЖВ на 100 г, вага штуки (г), густина (г/мл). */
export interface IngredientFacts { nutrition: Nutrition; unit_weight?: number; density?: number }

export interface RecipeNutrition {
  per_serving: { kcal: number; protein: number; fat: number; carbs: number };
  /** ≈: хоч один інгредієнт з оцінкою, пропущений або мл без густини. */
  approx: boolean;
  /** Скільки інгредієнтів не увійшло в підрахунок. */
  skipped: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Σ(кількість × БЖВ/100) / порції. Грами — як є; мл — через густину, без неї
 * 1:1 і ≈; штуки — через вагу одиниці з каталогу, без неї інгредієнт
 * пропускається; pack — пропуск; «за смаком» (без v/u) не рахується й не
 * пропуск. Жодного порахованого інгредієнта — null: рядок нема з чого показати.
 */
export function recipeNutrition(
  recipe: { sv?: number; ing: RecipeIngLike[] },
  resolve: (ing: RecipeIngLike) => IngredientFacts | null,
): RecipeNutrition | null {
  const servings = recipe.sv && recipe.sv > 0 ? recipe.sv : 1;
  let protein = 0, fat = 0, carbs = 0;
  let counted = 0, skipped = 0, approx = false;
  for (const ing of recipe.ing) {
    // «За смаком» (без кількості) — не пропуск, там нема чого рахувати.
    if (ing.v == null || !ing.u) continue;
    const facts = resolve(ing);
    if (!facts) { skipped++; continue; }
    let grams: number | null = null;
    if (ing.u === 'g') grams = ing.v;
    else if (ing.u === 'ml') {
      if (facts.density && facts.density > 0) grams = ing.v * facts.density;
      else { grams = ing.v; approx = true; }
    } else if (ing.u === 'pcs') {
      if (facts.unit_weight && facts.unit_weight > 0) grams = ing.v * facts.unit_weight;
    }
    if (grams == null) { skipped++; continue; }
    const k = grams / 100;
    protein += facts.nutrition.protein * k;
    fat += facts.nutrition.fat * k;
    carbs += facts.nutrition.carbs * k;
    if (isEstimate(facts.nutrition)) approx = true;
    counted++;
  }
  if (!counted) return null;
  if (skipped) approx = true;
  const per = { protein: protein / servings, fat: fat / servings, carbs: carbs / servings };
  return {
    per_serving: { kcal: kcalOf(per), protein: round1(per.protein), fat: round1(per.fat), carbs: round1(per.carbs) },
    approx,
    skipped,
  };
}
