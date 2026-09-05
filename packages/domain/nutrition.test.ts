import { describe, it, expect } from 'vitest';
import { kcalOf, nutritionIssue, recipeNutrition, isEstimate, type Nutrition } from './nutrition.js';

// Раунд 5, крок Н1: ккал не зберігаються — рахуються з БЖВ одним правилом
// 4-4-9 на весь моноліт.

const usda = (protein: number, fat: number, carbs: number, over: Partial<Nutrition> = {}): Nutrition =>
  ({ protein, fat, carbs, source: 'usda:1', ...over });

describe('kcalOf', () => {
  it('4-4-9, округлення до цілого', () => {
    expect(kcalOf({ protein: 24, fat: 4, carbs: 7 })).toBe(160);
    expect(kcalOf({ protein: 17.16, fat: 19.41, carbs: 0 })).toBe(243);
    expect(kcalOf({ protein: 0, fat: 100, carbs: 0 })).toBe(900);
  });
  it('Н1а: спирт — 7 ккал/г', () => {
    expect(kcalOf({ protein: 0, fat: 0, carbs: 0, alcohol: 33.2 })).toBe(232);   // горілка 40 %
    expect(kcalOf({ protein: 0.07, fat: 0, carbs: 2.61, alcohol: 10.6 })).toBe(85); // сухе червоне
  });
  it('isEstimate — лише source estimate', () => {
    expect(isEstimate(usda(1, 1, 1))).toBe(false);
    expect(isEstimate({ source: 'estimate' })).toBe(true);
  });
});

describe('nutritionIssue — санітарна перевірка', () => {
  it('чисті значення — null', () => {
    expect(nutritionIssue(usda(20, 10, 5, { fiber: 2 }))).toBeNull();
  });
  it('білки+жири+вуглеводи понад 100,5 г — порушення; клітковина не додається (вона вже у вуглеводах USDA)', () => {
    expect(nutritionIssue(usda(60, 30, 20))).toMatch(/100/);
    expect(nutritionIssue(usda(50, 30, 15, { fiber: 10 }))).toBeNull();
    expect(nutritionIssue(usda(0, 100.2, 0))).toBeNull();          // округлення дампу
    expect(nutritionIssue(usda(15.5, 4.25, 64.5, { fiber: 42.8 }))).toBeNull(); // висівки
    expect(nutritionIssue(usda(0, 0, 60, { alcohol: 45 }))).toMatch(/спирт/);
  });
  it('відʼємне значення — порушення; чистий жир (900 ккал) — межа, не порушення', () => {
    expect(nutritionIssue(usda(-1, 0, 0))).toMatch(/відʼємн/);
    expect(nutritionIssue({ protein: 0, fat: 100, carbs: 0, source: 'estimate' })).toBeNull();
    expect(nutritionIssue({ protein: 0, fat: 100, carbs: 1, source: 'estimate' })).toMatch(/100/);
    expect(nutritionIssue({ protein: 0, fat: 0, carbs: 0.1, alcohol: 33.2, source: 'ciqual:1008' })).toBeNull();
  });
});

describe('recipeNutrition — рядок під інгредієнтами', () => {
  const chicken = usda(23, 2, 0);                     // 100 г → 100 ккал
  const rice = usda(7, 1, 78, { source: 'estimate' }); // 100 г → 349 ккал
  const egg = usda(13, 11, 1);                        // 100 г → 155 ккал; штука 55 г

  it('грами: сума на 100 г, поділена на порції; усе з джерелом → без ≈', () => {
    const r = recipeNutrition(
      { sv: 2, ing: [{ n: 'курка', v: 300, u: 'g' }, { n: 'яйце', v: 100, u: 'g' }] },
      (ing) => ing.n === 'курка' ? { nutrition: chicken } : { nutrition: egg },
    );
    expect(r).toEqual({ per_serving: { kcal: 243, protein: 41, fat: 8.5, carbs: 0.5 }, approx: false, skipped: 0 });
  });

  it('штуки через вагу одиниці з каталогу; без ваги — пропуск і ≈', () => {
    const withWeight = recipeNutrition(
      { sv: 1, ing: [{ n: 'яйце', v: 2, u: 'pcs' }] },
      () => ({ nutrition: egg, unit_weight: 55 }),
    );
    expect(withWeight).toEqual({ per_serving: { kcal: 171, protein: 14.3, fat: 12.1, carbs: 1.1 }, approx: false, skipped: 0 });

    const noWeight = recipeNutrition(
      { sv: 1, ing: [{ n: 'яйце', v: 2, u: 'pcs' }, { n: 'курка', v: 200, u: 'g' }] },
      (ing) => ing.n === 'яйце' ? { nutrition: egg } : { nutrition: chicken },
    );
    expect(noWeight).toEqual({ per_serving: { kcal: 220, protein: 46, fat: 4, carbs: 0 }, approx: true, skipped: 1 });
  });

  it('оцінка хоч в одному інгредієнті → ≈; невідомий продукт і «за смаком» — пропуск', () => {
    const r = recipeNutrition(
      { sv: 1, ing: [{ n: 'рис', v: 100, u: 'g' }, { n: 'невідоме', v: 50, u: 'g' }, { n: 'сіль' }] },
      (ing) => ing.n === 'рис' ? { nutrition: rice } : null,
    );
    expect(r?.approx).toBe(true);
    expect(r?.skipped).toBe(1);
    expect(r?.per_serving.kcal).toBe(349);
  });

  it('мл — через густину, без неї 1:1 і ≈; pack — пропуск', () => {
    const milk = usda(3.3, 2.5, 4.8);
    const dens = recipeNutrition({ sv: 1, ing: [{ n: 'молоко', v: 200, u: 'ml' }] }, () => ({ nutrition: milk, density: 1.03 }));
    expect(dens?.approx).toBe(false);
    expect(dens?.per_serving.protein).toBe(6.8);
    const noDens = recipeNutrition({ sv: 1, ing: [{ n: 'молоко', v: 200, u: 'ml' }] }, () => ({ nutrition: milk }));
    expect(noDens?.approx).toBe(true);
    expect(noDens?.per_serving.protein).toBe(6.6);
    const pack = recipeNutrition({ sv: 1, ing: [{ n: 'паста', v: 1, u: 'pack' }, { n: 'рис', v: 100, u: 'g' }] }, () => ({ nutrition: rice }));
    expect(pack).toEqual({ per_serving: { kcal: 349, protein: 7, fat: 1, carbs: 78 }, approx: true, skipped: 1 });
  });

  it('жодного порахованого інгредієнта — null', () => {
    expect(recipeNutrition({ sv: 2, ing: [{ n: 'x', v: 1, u: 'pcs' }] }, () => null)).toBeNull();
    expect(recipeNutrition({ sv: 2, ing: [] }, () => null)).toBeNull();
  });
});
