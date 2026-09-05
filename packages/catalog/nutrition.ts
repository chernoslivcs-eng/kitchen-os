// Раунд 5, крок Н1: БЖВ позиції каталогу на 100 г. Без ккал — вони рахуються
// одним правилом 4-4-9 у домені (kcalOf), а не зберігаються.
//
// source: звідки числа. `usda:<fdc_id>` — звірено з дампом USDA FoodData
// Central (public domain); `ciqual:<code>` — CIQUAL/ANSES (CC-BY), як є;
// `estimate` — оцінка без джерела (усе, що було в каталозі до звірки).

export type NutritionSource = 'estimate' | `usda:${string}` | `ciqual:${string}`;

export interface Nutrition {
  protein: number;
  fat: number;
  carbs: number;
  fiber?: number;
  sugars?: number;
  sodium_mg?: number;
  source: NutritionSource;
}
