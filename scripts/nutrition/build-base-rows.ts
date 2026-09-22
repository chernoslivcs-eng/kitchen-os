// Раунд 5, крок Н1 (§3), етап 5: data/nutrition/base.csv → JSON, щоб рядки
// бази були доступні В РАНТАЙМІ (пряме зіставлення назви продукту ДОМУ, не
// лише каталогу — packages/catalog/runtime-base-match.ts). CSV як є esbuild
// не бандлить (немає loader'а); .json — бандлить нарівні зі звичайним
// import (перевірено: services/api/src/nutrition.ts бере дані звідси).
//
// Це ПОХІДНИЙ файл (як packages/catalog/data/nutrition.base.json від
// apply-base.ts) — сам base.csv цей скрипт НЕ чіпає, лише читає. Перегенерувати
// після кожної зміни base.csv (етап 4 паралельно додає рядки — після ребейзу
// прогнати знову):
//   npx tsx scripts/nutrition/build-base-rows.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const IN = resolve(ROOT, 'data/nutrition/base.csv');
const OUT = resolve(ROOT, 'packages/catalog/data/nutrition-base-rows.json');

const num = (s: string | undefined) => (s === undefined || s === '' ? undefined : Number(s));

interface BaseRow {
  name: string; state: string;
  protein: number; fat: number; carbs: number;
  fiber?: number; sugars?: number; sodium_mg?: number; alcohol?: number;
  source: string;
}

const lines = readFileSync(IN, 'utf-8').split('\n').slice(1).filter(Boolean);
const rows: BaseRow[] = lines.map((l) => {
  const [name, state, protein, fat, carbs, fiber, sugars, sodium, source, alcohol] = l.split(';');
  const row: BaseRow = { name: name!, state: state!, protein: num(protein) ?? 0, fat: num(fat) ?? 0, carbs: num(carbs) ?? 0, source: source! };
  if (num(fiber) !== undefined) row.fiber = num(fiber);
  if (num(sugars) !== undefined) row.sugars = num(sugars);
  if (num(sodium) !== undefined) row.sodium_mg = num(sodium);
  if (num(alcohol) !== undefined) row.alcohol = num(alcohol);
  return row;
});

writeFileSync(OUT, JSON.stringify(rows, null, 1) + '\n');
console.log(`${rows.length} рядків → ${OUT}`);
