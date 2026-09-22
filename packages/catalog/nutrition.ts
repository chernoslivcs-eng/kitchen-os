// Раунд 5, крок Н1: БЖВ позиції каталогу на 100 г. Без ккал — вони рахуються
// одним правилом 4-4-9 у домені (kcalOf), а не зберігаються.
//
// source: звідки числа. `usda:<fdc_id>` — звірено з дампом USDA FoodData
// Central (public domain); `ciqual:<code>` — CIQUAL/ANSES (CC-BY), як є;
// `estimate` — оцінка без джерела (усе, що було в каталозі до звірки);
// `label:<домен>@<ISO-дата>` (етап 2, 22.09) — етикетка конкретного бренду,
// звірена вручну (NUTRI-LABELS-REPORT-0922.md, «Ухвалено 22.09») — точніша за
// усереднений рядок USDA для одного продукту. Домен і дата обов'язкові: без
// них за півроку не видно, що саме перевіряли і коли. Рядків із цим джерелом
// поки НЕМА в data/nutrition/base.csv (це відкриває двері для етапу 4) — сам
// формат готовий і валідується (isValidLabelSource, scripts/nutrition/apply-base.ts).

export type NutritionSource = 'estimate' | `usda:${string}` | `ciqual:${string}` | `label:${string}`;

const LABEL_SOURCE_RE = /^label:([a-z0-9-]+(?:\.[a-z0-9-]+)+)@(\d{4}-\d{2}-\d{2})$/;

/** `label:<домен>@<ISO-дата>` — правильна форма: домен (бодай одна крапка,
 * TLD) і дата, що справді існує (round-trip через Date, ловить «2026-02-30»). */
export function isValidLabelSource(source: string): boolean {
  const m = LABEL_SOURCE_RE.exec(source);
  if (!m) return false;
  const iso = m[2]!;
  const d = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

export interface Nutrition {
  protein: number;
  fat: number;
  carbs: number;
  fiber?: number;
  sugars?: number;
  sodium_mg?: number;
  /** Спирт, г/100 г (Н1а): USDA нутрієнт 1018 або CIQUAL-рядки алкоголю; 7 ккал/г у kcalOf. */
  alcohol?: number;
  source: NutritionSource;
}
