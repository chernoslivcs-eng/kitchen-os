import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { kcalOf, carbsForDisplay, nutritionIssue, recipeNutrition, isEstimate, resolveNutrition, type Nutrition } from './nutrition.js';

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
  it('isEstimate — лише source estimate; label: (етап 2) — НЕ оцінка, звірене', () => {
    expect(isEstimate(usda(1, 1, 1))).toBe(false);
    expect(isEstimate({ source: 'estimate' })).toBe(true);
    expect(isEstimate({ source: 'label:veres.ua@2026-09-22' })).toBe(false);
  });

  // Клітковина — 2 ккал/г, не 4, АЛЕ по-різному залежно від джерела:
  // usda «by difference» carbs УЖЕ містить fiber → віднімаємо перед 4-ккал
  // частиною. ciqual «glucides» carbs — УЖЕ БЕЗ fiber (окрема величина) →
  // віднімати не можна, лише додати окремо (ГОЛОВНИЙ ЧАТ, виправлення після
  // #192: «Водорості вакаме» carbs 13.3 при fiber 42.9 — carbs<fiber, за
  // конструкцією не може містити її). Значення — реальні рядки
  // data/nutrition/base.csv, очікування (усда) — з NUTRI-LABELS-REPORT-0922.md.
  it('Н1б: usda — клітковина віднімається з carbs і рахується окремо по 2 ккал/г (реальні рядки бази, звірено зі звітом)', () => {
    // Розмарин сушений (usda): Б4.88 Ж15.22 В64.06 клітковина42.6 · було 413 → стало 328
    expect(kcalOf({ protein: 4.88, fat: 15.22, carbs: 64.06, fiber: 42.6, source: 'usda:171333' })).toBe(328);
    // Куркума (usda): Б9.68 Ж3.25 В67.14 клітковина22.7 · було 337 → стало 291
    expect(kcalOf({ protein: 9.68, fat: 3.25, carbs: 67.14, fiber: 22.7, source: 'usda:172231' })).toBe(291);
    // Лавровий лист (usda): Б7.61 Ж8.36 В74.97 клітковина26.3 · було 406 → стало 353
    expect(kcalOf({ protein: 7.61, fat: 8.36, carbs: 74.97, fiber: 26.3, source: 'usda:170917' })).toBe(353);
    // Маш (usda): Б23.86 Ж1.15 В62.62 клітковина16.3 · було 356 → стало 324
    expect(kcalOf({ protein: 23.86, fat: 1.15, carbs: 62.62, fiber: 16.3, source: 'usda:174256' })).toBe(324);
  });
  it('Н1б: ciqual — carbs УЖЕ без клітковини, вона рахується окремо по 2 ккал/г ПОВЕРХ carbs, не віднімається', () => {
    // Водорості вакаме (ciqual): Б12.2 Ж1.5 В13.3 клітковина42.9 — carbs<fiber,
    // тому й доказ, що carbs тут не може містити fiber (усда-віднімання дало б відʼємне).
    expect(kcalOf({ protein: 12.2, fat: 1.5, carbs: 13.3, fiber: 42.9, source: 'ciqual:20999' })).toBe(201);
    // Водорості норі (ciqual): Б30.2 Ж1.77 В11.7 клітковина36.8
    expect(kcalOf({ protein: 30.2, fat: 1.77, carbs: 11.7, fiber: 36.8, source: 'ciqual:20987' })).toBe(257);
  });
  it('Н1б, етап 2: label: — та сама механіка, що ciqual (переконайся: fiberRuleFor уже враховує)', () => {
    expect(kcalOf({ protein: 12.2, fat: 1.5, carbs: 13.3, fiber: 42.9, source: 'label:veres.ua@2026-09-22' }))
      .toBe(kcalOf({ protein: 12.2, fat: 1.5, carbs: 13.3, fiber: 42.9, source: 'ciqual:20999' }));
    expect(carbsForDisplay({ carbs: 13.3, fiber: 42.9, source: 'label:veres.ua@2026-09-22' })).toBe(13.3);
  });
  it('без fiber (35 рядків бази з 677) — уся carbs по 4, як було раніше (незалежно від джерела)', () => {
    expect(kcalOf({ protein: 4.88, fat: 15.22, carbs: 64.06, source: 'usda:171333' })).toBe(413);
    expect(kcalOf({ protein: 4.88, fat: 15.22, carbs: 64.06, fiber: undefined, source: 'usda:171333' })).toBe(413);
  });
  it('estimate (чи джерело незнане/відсутнє) — клітковину ігноруємо взагалі, навіть якщо вона є', () => {
    // CATALOG_GENERIC має estimate-рядки З fiber (нечисте раунд-число);
    // формула НЕ повинна її рахувати — ані відняти, ані додати.
    expect(kcalOf({ protein: 12, fat: 3, carbs: 75, fiber: 10, source: 'estimate' })).toBe(kcalOf({ protein: 12, fat: 3, carbs: 75, source: 'estimate' }));
    expect(kcalOf({ protein: 12, fat: 3, carbs: 75, fiber: 10, source: 'estimate' })).toBe(375);
    expect(kcalOf({ protein: 4.88, fat: 15.22, carbs: 64.06, fiber: 42.6 })).toBe(413); // без source узагалі — те саме, що estimate
  });
});

describe('carbsForDisplay — вуглеводи на екран (комора, рецепт)', () => {
  it('usda — carbs − fiber; маш 62,62 → 46,3, як на етикетці', () => {
    expect(carbsForDisplay({ carbs: 62.62, fiber: 16.3, source: 'usda:174256' })).toBeCloseTo(46.32, 5);
  });
  it('ciqual — carbs як є, НЕ віднімається (вакаме/норі не змінюються)', () => {
    expect(carbsForDisplay({ carbs: 13.3, fiber: 42.9, source: 'ciqual:20999' })).toBe(13.3);
    expect(carbsForDisplay({ carbs: 11.7, fiber: 36.8, source: 'ciqual:20987' })).toBe(11.7);
  });
  it('estimate/без джерела — carbs як є', () => {
    expect(carbsForDisplay({ carbs: 75, fiber: 10, source: 'estimate' })).toBe(75);
    expect(carbsForDisplay({ carbs: 64.06, fiber: 42.6 })).toBe(64.06);
  });
  it('немає fiber — carbs як є, незалежно від джерела', () => {
    expect(carbsForDisplay({ carbs: 64.06, source: 'usda:171333' })).toBe(64.06);
  });
});

describe('carbsForDisplay/kcalOf — захисні перевірки по ВСІХ рядках data/nutrition/base.csv', () => {
  const csvPath = new URL('../../data/nutrition/base.csv', import.meta.url);
  const rows = readFileSync(csvPath, 'utf-8').split('\n').slice(1).filter(Boolean).map((l) => {
    const [name, , protein, fat, carbs, fiber, , , source] = l.split(';');
    return { name: name!, protein: Number(protein), fat: Number(fat), carbs: Number(carbs), fiber: fiber ? Number(fiber) : undefined, source: source! };
  });
  // Пін на кількість рядків — сторожок «хтось чіпав base.csv». Етап 4 додав
  // 17 рядків із українських етикеток (label:), було 665.
  it(`${rows.length} рядків прочитано`, () => {
    expect(rows.length).toBe(682);
  });
  it('жодна відображена величина вуглеводів не відʼємна', () => {
    const negatives = rows.filter((r) => carbsForDisplay(r) < 0);
    expect(negatives.map((r) => r.name)).toEqual([]);
  });
  it('перерахований ккал не порушує межу nutritionIssue (905) на жодному рядку', () => {
    const over = rows.filter((r) => kcalOf(r) > 905);
    expect(over.map((r) => r.name)).toEqual([]);
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

// Етап 5: назва продукту дому перемагає узагальнену каталожну, коли резолвер
// дав сильний збіг по НІЙ; інакше — як було. Реальні рядки бази (не мок) —
// щоб довести саме інтеграцію з matchProductNameToBaseRow, не її підміну.
describe('resolveNutrition: назва продукту дому виграє в каталожної, коли резолвер її впізнав сильним правилом', () => {
  const catalogFallback: Nutrition = { protein: 1, fat: 1, carbs: 1, source: 'estimate' };
  it('продукт дому впізнано (exact) — його рядок, не каталожний', () => {
    const r = resolveNutrition(catalogFallback, 'Гірчиця');
    expect(r).toEqual({ protein: 3.74, fat: 3.34, carbs: 5.83, fiber: 4, sugars: 0.92, sodium_mg: 1104, source: 'usda:172234' });
  });
  it('назва без уточнення / резолвер мовчить — каталожний рядок, як і раніше', () => {
    expect(resolveNutrition(catalogFallback, 'щось геть невідоме xyz987')).toBe(catalogFallback);
    expect(resolveNutrition(catalogFallback, null)).toBe(catalogFallback);
    expect(resolveNutrition(catalogFallback, '')).toBe(catalogFallback);
  });
  it('немає каталожного fallback і резолвер теж мовчить — undefined', () => {
    expect(resolveNutrition(undefined, 'щось геть невідоме xyz987')).toBeUndefined();
  });
});
