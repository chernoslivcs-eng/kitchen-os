import { plural } from './plural';
import type { RecipeNutritionInfo } from '../api';

/**
 * Етап 4, Р12 — закриває DEBT §21. У рецепта два числа калорій із двох джерел:
 *   · `nu` — оцінка МОДЕЛІ. Пишуть її лише дві промпт-схеми (recipe-generator і
 *     attachment-parser), і обидві — модель; імпорт із фото теж не читає
 *     таблицю. Тому це не прапорець `est` у даних (він був би константою), а
 *     факт про джерело, і слово стоїть у кожному рядку;
 *   · `nutrition_calc` — розрахунок сервера з КАТАЛОГУ по інгредієнтах.
 * Розбіжність між ними сягала 30 % в обидва боки (DEBT §21), і ніде на екрані
 * не було сказано, що це різні речі. Тепер кожне число називає, звідки воно.
 */
export const NUTRITION_SOURCE = { model: 'оцінка моделі', catalog: 'з каталогу' } as const;

// Раунд 5, крок Н1 (§4): «≈ 620 ккал · Б 32 · Ж 28 · В 55 на порцію».
// «≈» — коли хоч один інгредієнт з оцінкою або пропущений; «без N інгредієнтів»
// — скільки не увійшло (нема в каталозі або штука без ваги одиниці).
export function formatNutritionLine(c: RecipeNutritionInfo): string {
  const n = c.per_serving;
  const head = `${c.approx ? '≈ ' : ''}${n.kcal} ккал · Б ${Math.round(n.protein)} · Ж ${Math.round(n.fat)} · В ${Math.round(n.carbs)} на порцію`;
  const skipped = c.skipped ? ` · без ${c.skipped} ${plural(c.skipped, ['інгредієнта', 'інгредієнтів', 'інгредієнтів'])}` : '';
  return `${head}${skipped} · ${NUTRITION_SOURCE.catalog}`;
}

/** Оцінка моделі — завжди «≈», завжди підписана. */
export function formatModelEstimate(nu: { kcal: number; p: number; f: number; c: number }, form: 'full' | 'short' = 'full'): string {
  if (form === 'short') return `≈ ${nu.kcal} ккал · ${NUTRITION_SOURCE.model}`;
  return `≈ ${nu.kcal} ккал · Б ${Math.round(nu.p)} · Ж ${Math.round(nu.f)} · В ${Math.round(nu.c)} на порцію · ${NUTRITION_SOURCE.model}`;
}
