import { describe, it, expect } from 'vitest';
import { formatNutritionLine } from './nutrition';

describe('formatNutritionLine', () => {
  it('усе зі джерелом, без пропусків — без ≈', () => {
    expect(formatNutritionLine({ per_serving: { kcal: 620, protein: 32.4, fat: 27.6, carbs: 55 }, approx: false, skipped: 0 }))
      .toBe('620 ккал · Б 32 · Ж 28 · В 55 на порцію');
  });
  it('оцінка або пропуск — ≈ і «без N інгредієнтів»', () => {
    expect(formatNutritionLine({ per_serving: { kcal: 410, protein: 20, fat: 10, carbs: 50 }, approx: true, skipped: 1 }))
      .toBe('≈ 410 ккал · Б 20 · Ж 10 · В 50 на порцію · без 1 інгредієнта');
    expect(formatNutritionLine({ per_serving: { kcal: 410, protein: 20, fat: 10, carbs: 50 }, approx: true, skipped: 3 }))
      .toMatch(/без 3 інгредієнтів$/);
  });
});
