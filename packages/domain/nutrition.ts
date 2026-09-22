// Раунд 5, крок Н1: ккал з БЖВ одним правилом на весь моноліт, санітарна
// перевірка рядка й підрахунок рецепта з інгредієнтів.
//
// Ккал не зберігаються ніде: каталог тримає protein/fat/carbs на 100 г і
// джерело (usda / ciqual / estimate), усе інше — похідне. Так число не
// розʼїжджається між сідом, коморою й рецептом.

import type { Nutrition } from '@kitchen/catalog';

export type { Nutrition, NutritionSource } from '@kitchen/catalog';

/**
 * Як клітковина стосується `carbs` — залежить від ДЖЕРЕЛА, не однаково всюди:
 *  - `usda:` — «carbohydrate by difference» вже МІСТИТЬ клітковину (nutrition-
 *    Issue поруч) → віднімаємо з 4-ккал частини, рахуємо окремо по 2.
 *  - `ciqual:` (і майбутній `label:`, етап 2 — етикетка декларує так само, як
 *    ciqual) — carbs УЖЕ БЕЗ клітковини («glucides» — засвоювані вуглеводи):
 *    віднімати ще раз не можна, від'ємне число («Водорості вакаме» carbs 13.3
 *    при fiber 42.9 — carbs<fiber, за конструкцією не може містити її).
 *    Клітковина додається ОКРЕМО, по 2 ккал/г, зверху.
 *  - `estimate` (чи будь-що незнане) — походження невідоме, клітковину не
 *    чіпаємо взагалі (навіть якщо якийсь рядок CATALOG_GENERIC її має) — carbs
 *    цілком по 4, як до цієї правки.
 */
type FiberRule = 'subtract' | 'add' | 'ignore';
function fiberRuleFor(source: string | undefined): FiberRule {
  if (source?.startsWith('usda:')) return 'subtract';
  if (source?.startsWith('ciqual:') || source?.startsWith('label:')) return 'add';
  return 'ignore';
}

/** Ккал із уже готових складових: carbsAt4 — те, що йде в 4-ккал частину
 * (для usda — carbs МІНУС fiber, для ciqual/estimate — carbs як є); fiberAt2
 * — скільки клітковини рахувати окремо по 2 ккал (0 для estimate). Джерело
 * тут більше не питається — рішення про нього вже прийнято раніше. */
function kcalFromParts(protein: number, fat: number, carbsAt4: number, fiberAt2: number, alcohol: number): number {
  return Math.round(protein * 4 + carbsAt4 * 4 + fiberAt2 * 2 + fat * 9 + alcohol * 7);
}

/** 4-4-9 (+7 на грам спирту, Н1а) + клітковина окремо по 2 ккал/г — правило
 * залежить від джерела (fiberRuleFor). Округлення до цілого. */
export function kcalOf(n: { protein: number; fat: number; carbs: number; fiber?: number; alcohol?: number; source?: string }): number {
  const fiber = n.fiber ?? 0;
  const rule = fiberRuleFor(n.source);
  const carbsAt4 = rule === 'subtract' ? n.carbs - fiber : n.carbs;
  const fiberAt2 = rule === 'ignore' ? 0 : fiber;
  return kcalFromParts(n.protein, n.fat, carbsAt4, fiberAt2, n.alcohol ?? 0);
}

/**
 * Вуглеводи, що йдуть НА ЕКРАН (комора, рецепт) — «доступні» вуглеводи, як на
 * етикетці. `usda:` — carbs мінус fiber (carbs «by difference» містить її);
 * `ciqual:`/`label:`/`estimate` — carbs як є (уже без клітковини, або
 * походження невідоме — не чіпаємо). Немає fiber — як є, завжди.
 */
export function carbsForDisplay(n: { carbs: number; fiber?: number; source?: string }): number {
  if (n.fiber == null) return n.carbs;
  return fiberRuleFor(n.source) === 'subtract' ? n.carbs - n.fiber : n.carbs;
}

export const isEstimate = (n: { source: string }): boolean => n.source === 'estimate';

/**
 * Санітарна перевірка одного рядка: білки+жири+вуглеводи (+спирт) не більше
 * 100,5 г на 100 г продукту (0,5 — округлення дампу; клітковина в цю суму НЕ
 * входить — для usda вона вже частина carbs, для ciqual/label — окрема
 * величина понад carbs, тож не додається і не віднімається тут), жодного
 * відʼємного числа, ккал у межах 0–905 (чистий жир — 900 плюс запас). 905
 * лишається безпечною межею НЕЗАЛЕЖНО від джерела/fiberRuleFor — перевірка
 * рахується від фактичного kcalOf(n) (уже source-aware), а не від суми макро
 * вище, тож ловить і пограничну клітковину в ciqual-рядках, яку сама сума не
 * бачить. Повертає опис або null.
 */
export function nutritionIssue(n: Nutrition): string | null {
  const vals: [string, number | undefined][] = [
    ['protein', n.protein], ['fat', n.fat], ['carbs', n.carbs], ['fiber', n.fiber], ['sugars', n.sugars], ['sodium_mg', n.sodium_mg], ['alcohol', n.alcohol],
  ];
  for (const [k, v] of vals) {
    if (v === undefined) continue;
    if (!Number.isFinite(v)) return `${k}: не число`;
    if (v < 0) return `${k}: відʼємне (${v})`;
  }
  const macro = n.protein + n.fat + n.carbs + (n.alcohol ?? 0);
  if (macro > 100.5) return `білки+жири+вуглеводи+спирт = ${round1(macro)} г > 100.5`;
  // Верхня межа з тим самим запасом на округлення: 100,5 г жиру = 904,5 ккал.
  const kcal = kcalOf(n);
  if (kcal > 905) return `ккал 4-4-9 = ${kcal} > 905`;
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
  // carbs/fiber тут — уже ПІСЛЯ fiberRuleFor по кожному інгредієнту окремо
  // (джерела в рецепті можуть бути мішані: усда+сіквал одночасно), тож на
  // відміну від kcalOf/carbsForDisplay підсумок нижче джерело більше не питає.
  let protein = 0, fat = 0, carbs = 0, fiber = 0, alcohol = 0;
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
    const rule = fiberRuleFor(facts.nutrition.source);
    const fiberG = facts.nutrition.fiber ?? 0;
    protein += facts.nutrition.protein * k;
    fat += facts.nutrition.fat * k;
    carbs += (rule === 'subtract' ? facts.nutrition.carbs - fiberG : facts.nutrition.carbs) * k;
    fiber += (rule === 'ignore' ? 0 : fiberG) * k;
    alcohol += (facts.nutrition.alcohol ?? 0) * k;
    if (isEstimate(facts.nutrition)) approx = true;
    counted++;
  }
  if (!counted) return null;
  if (skipped) approx = true;
  const per = { protein: protein / servings, fat: fat / servings, carbs: carbs / servings, fiber: fiber / servings, alcohol: alcohol / servings };
  return {
    per_serving: { kcal: kcalFromParts(per.protein, per.fat, per.carbs, per.fiber, per.alcohol), protein: round1(per.protein), fat: round1(per.fat), carbs: round1(per.carbs) },
    approx,
    skipped,
  };
}
