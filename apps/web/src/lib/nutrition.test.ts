import { describe, it, expect } from 'vitest';
import { formatNutritionLine, formatModelEstimate, NUTRITION_SOURCE } from './nutrition';

// Етап 4, Р12 (закриває DEBT §21): у рецепта два числа калорій із двох
// джерел — оцінка моделі (`nu`) і розрахунок з каталогу (`nutrition_calc`), —
// і розбіжність між ними сягала 30 %. Ніде на екрані не було сказано, що це
// різні речі. Тепер кожне число називає джерело. `nu` — завжди оцінка: його
// пишуть лише дві промпт-схеми, і обидві — модель; тому «оцінка моделі» не
// прапорець у даних, а факт про джерело.
describe('formatNutritionLine — розрахунок з каталогу', () => {
  it('усе зі джерелом, без пропусків — без ≈, і названо: з каталогу', () => {
    expect(formatNutritionLine({ per_serving: { kcal: 620, protein: 32.4, fat: 27.6, carbs: 55 }, approx: false, skipped: 0 }))
      .toBe('620 ккал · Б 32 · Ж 28 · В 55 на порцію · з каталогу');
  });
  it('оцінка або пропуск — ≈ і «без N інгредієнтів», джерело те саме', () => {
    expect(formatNutritionLine({ per_serving: { kcal: 410, protein: 20, fat: 10, carbs: 50 }, approx: true, skipped: 1 }))
      .toBe('≈ 410 ккал · Б 20 · Ж 10 · В 50 на порцію · без 1 інгредієнта · з каталогу');
    expect(formatNutritionLine({ per_serving: { kcal: 410, protein: 20, fat: 10, carbs: 50 }, approx: true, skipped: 3 }))
      .toMatch(/без 3 інгредієнтів · з каталогу$/);
  });
});

describe('formatModelEstimate — оцінка моделі', () => {
  it('завжди ≈ і завжди «оцінка моделі»: інакше число видавало б себе за знання', () => {
    expect(formatModelEstimate({ kcal: 540, p: 28, f: 22, c: 55 }))
      .toBe('≈ 540 ккал · Б 28 · Ж 22 · В 55 на порцію · оцінка моделі');
  });
  it('коротка форма для картки в чаті — те саме джерело', () => {
    expect(formatModelEstimate({ kcal: 540, p: 28, f: 22, c: 55 }, 'short')).toBe('≈ 540 ккал · оцінка моделі');
  });
  it('два джерела названі різними словами', () => {
    expect(NUTRITION_SOURCE.model).not.toBe(NUTRITION_SOURCE.catalog);
  });
});
