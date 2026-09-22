import { describe, it, expect } from 'vitest';
import { kcalOf, carbsForDisplay, nutritionIssue, recipeNutrition, isEstimate, type Nutrition } from './nutrition.js';

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

  // Клітковина — 2 ккал/г, не 4: carbs «by difference» вже містить її
  // (NUTRI-LABELS-REPORT-0922.md, «Найбільша одна правка»). Значення —
  // реальні рядки data/nutrition/base.csv, очікування — з того самого звіту
  // (перевірено вручну до запуску тестів, збіглось до ккал з першого разу).
  it('Н1б: клітковина 2 ккал/г — реальні рядки бази, звірено зі звітом', () => {
    // Розмарин сушений: Б4.88 Ж15.22 В64.06 клітковина42.6 · було 413 → стало 328
    expect(kcalOf({ protein: 4.88, fat: 15.22, carbs: 64.06, fiber: 42.6 })).toBe(328);
    // Куркума: Б9.68 Ж3.25 В67.14 клітковина22.7 · було 337 → стало 291
    expect(kcalOf({ protein: 9.68, fat: 3.25, carbs: 67.14, fiber: 22.7 })).toBe(291);
    // Лавровий лист: Б7.61 Ж8.36 В74.97 клітковина26.3 · було 406 → стало 353
    expect(kcalOf({ protein: 7.61, fat: 8.36, carbs: 74.97, fiber: 26.3 })).toBe(353);
    // Маш: Б23.86 Ж1.15 В62.62 клітковина16.3 · було 356 → стало 324
    expect(kcalOf({ protein: 23.86, fat: 1.15, carbs: 62.62, fiber: 16.3 })).toBe(324);
  });
  it('без fiber (35 рядків бази з 677) — уся carbs по 4, як було раніше', () => {
    expect(kcalOf({ protein: 4.88, fat: 15.22, carbs: 64.06 })).toBe(413);
    expect(kcalOf({ protein: 4.88, fat: 15.22, carbs: 64.06, fiber: undefined })).toBe(413);
  });
});

describe('carbsForDisplay — вуглеводи на екран (комора, рецепт), без клітковини', () => {
  it('є fiber — carbs − fiber; маш 62,62 → 46,3, як на етикетці', () => {
    expect(carbsForDisplay({ carbs: 62.62, fiber: 16.3 })).toBeCloseTo(46.32, 5);
  });
  it('немає fiber — carbs як є', () => {
    expect(carbsForDisplay({ carbs: 64.06 })).toBe(64.06);
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
  // Н1б: 905 лишається безпечною межею й після переходу kcalOf на 2 ккал/г
  // клітковини — вона лише переносить частину ваги carbs із 4 на 2, тобто
  // ккал під новою формулою ніколи не вищий за старий (перевір формулу).
  it('905 — межа ккал лишається коректною і з високою клітковиною (Н1б)', () => {
    // Розмарин сушений: сума Б+Ж+В=84.25 ≤100.5 (нижче межі й раніше), ккал
    // за новою формулою 328 (було 413) — з великим запасом під 905.
    expect(nutritionIssue({ protein: 4.88, fat: 15.22, carbs: 64.06, fiber: 42.6, source: 'usda:171333' })).toBeNull();
    // Майже чистий жир (100 г, макс. з-під межі суми) + вся клітковина, яку
    // тільки дозволяє carbs=0.5 — ккал усе одно не вище, ніж без клітковини.
    expect(nutritionIssue({ protein: 0, fat: 100, carbs: 0.5, fiber: 0.5, source: 'estimate' })).toBeNull();
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

  it('Н1б: клітковина зважується по інгредієнтах окремо від carbs; В на картці = carbs − fiber (реальний рядок бази — маш)', () => {
    const mash = usda(23.86, 1.15, 62.62, { fiber: 16.3 }); // data/nutrition/base.csv
    const r = recipeNutrition(
      { sv: 1, ing: [{ n: 'маш', v: 200, u: 'g' }, { n: 'курка', v: 100, u: 'g' }] },
      (ing) => ing.n === 'маш' ? { nutrition: mash } : { nutrition: chicken },
    );
    expect(r).toEqual({ per_serving: { kcal: 757, protein: 70.7, fat: 4.3, carbs: 92.6 }, approx: false, skipped: 0 });
  });

  it('жодного порахованого інгредієнта — null', () => {
    expect(recipeNutrition({ sv: 2, ing: [{ n: 'x', v: 1, u: 'pcs' }] }, () => null)).toBeNull();
    expect(recipeNutrition({ sv: 2, ing: [] }, () => null)).toBeNull();
  });
});
