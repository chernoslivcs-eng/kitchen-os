// Етап 5: конкретна назва ПРОДУКТУ ДОМУ («оливки Iruela зелені Chupadedos»,
// «желе сухе Мрія», «олія Metro Chef з трюфелем») несе уточнення, якого нема
// в узагальненій назві каталожної позиції — apply-base.ts запікає нутрієнти
// в позицію КАТАЛОГУ, проганяючи через BaseMatcher назву каталогу, а не
// партії. pantryItemView/recipeNutritionFor після цього беруть лише
// BY_KEY.get(key).nutrition — назва партії в цьому ланцюгу не бере участі
// взагалі, хоча в базі (data/nutrition/base.csv) часто вже ЛЕЖИТЬ саме той
// конкретніший рядок («Оливки зелені в олії», «Майонез 67%», «Желе сухе»).
//
// Рядки бази доступні в рантаймі через похідний JSON (packages/catalog/data/
// nutrition-base-rows.json, scripts/nutrition/build-base-rows.ts) — сам CSV
// esbuild не бандлить, .json — бандлить нарівні з import (перевірено на
// зібраному api-dist/server.mjs).
//
// Лише СИЛЬНІ правила (override/exact/alias/head+percent) — keyword
// (категорія + одне слово) найслабший і дає найбільше хибних збігів: аудит
// етапу 3а (CATALOG-KEY-AUDIT-0922.md) — «груша» через keyword зловила
// «топінамбур». Дозволити keyword тут означало б повторити ту саму помилку
// вже на живих партіях, не на аудиті.

import baseRowsJson from './data/nutrition-base-rows.json' with { type: 'json' };
import aliasesJson from '../../scripts/nutrition/aliases.json' with { type: 'json' };
import { BaseMatcher, type NutritionAliases, type MatchRule } from './nutrition-match.js';
import type { Nutrition } from './nutrition.js';

interface BaseRow {
  name: string; state: string;
  protein: number; fat: number; carbs: number;
  fiber?: number; sugars?: number; sodium_mg?: number; alcohol?: number;
  source: string;
}
const rows = baseRowsJson as BaseRow[];
const aliases = aliasesJson as NutritionAliases;

const byName = new Map(rows.map((r) => [r.name, r]));
const states = new Map(rows.map((r) => [r.name, r.state]));
const matcher = new BaseMatcher(rows.map((r) => r.name), aliases, states);

const STRONG_RULES: ReadonlySet<MatchRule> = new Set(['override', 'exact', 'alias', 'head+percent']);

function rowToNutrition(row: BaseRow): Nutrition {
  const n: Nutrition = { protein: row.protein, fat: row.fat, carbs: row.carbs, source: row.source as Nutrition['source'] };
  if (row.fiber !== undefined) n.fiber = row.fiber;
  if (row.sugars !== undefined) n.sugars = row.sugars;
  if (row.sodium_mg !== undefined) n.sodium_mg = row.sodium_mg;
  if (row.alcohol !== undefined) n.alcohol = row.alcohol;
  return n;
}

/**
 * Нутрієнти за НАЗВОЮ ПРОДУКТУ ДОМУ (не каталогу) — конкретніший рядок бази,
 * коли він є, а не узагальнений, запечений у позицію каталогу. `label` — рядок
 * на розсуд виклику; сама функція його не парсить. Виклики цього стажу
 * (pantry-view.ts, services/api/src/nutrition.ts) передають `product + variant`
 * БЕЗ бренду — емпірично краще на реальних партіях, ніж повний displayName
 * (0 програшів / 5 виграшів на 146 перевірених; причина — у `resolveNutrition`,
 * packages/domain/nutrition.ts). Бренд у рядку тут не ЗАБОРОНЕНИЙ (деякі
 * override-записи ключовані по повній фразі з брендом, напр. «молоко кокосове
 * бариста») — лише не обраний для виклику через нього.
 * null — матчер мовчить АБО дав лише keyword (найслабше) — виклик має впасти
 * на нинішню поведінку (нутрієнти каталожної позиції).
 */
export function matchProductNameToBaseRow(label: string): Nutrition | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  const m = matcher.match({ name: trimmed, aliases: [], categories: [] });
  if (!m || !STRONG_RULES.has(m.rule)) return null;
  const row = byName.get(m.base);
  return row ? rowToNutrition(row) : null;
}
