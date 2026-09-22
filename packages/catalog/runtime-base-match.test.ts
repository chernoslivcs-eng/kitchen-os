import { describe, it, expect } from 'vitest';
import { matchProductNameToBaseRow } from './runtime-base-match.js';

// Етап 5: нутрієнти за назвою ПРОДУКТУ ДОМУ (не каталогу) — див. коментар
// у runtime-base-match.ts. Лише СИЛЬНІ правила (override/exact/alias/
// head+percent); keyword (категорія+слово) — ні (аудит етапу 3а: «груша»
// keyword-ом зловила «топінамбур»).

describe('matchProductNameToBaseRow: сильні правила — так, keyword — ні', () => {
  it('exact після зняття бренду — знаходить (реальний рядок бази)', () => {
    const r = matchProductNameToBaseRow('Молоко Metro Chef 2,5%');
    expect(r).not.toBeNull();
    expect(r?.source).toBe('usda:171267');
  });
  it('head+percent — знаходить (реальний рядок бази, «Вершки»)', () => {
    const r = matchProductNameToBaseRow('Вершки Галичина 33%');
    expect(r).not.toBeNull();
    expect(r?.source).toBe('usda:170859');
  });
  it('exact без бренду взагалі — знаходить («Гірчиця», рядок label: з етапу 4)', () => {
    const r = matchProductNameToBaseRow('Гірчиця');
    expect(r).toEqual({ protein: 6.4, fat: 7.8, carbs: 15.6, fiber: 0, source: 'label:veresfood.com@2026-09-22' });
  });
  it('keyword — НЕ приймається, навіть коли резолвер сам по собі знайшов би (реальний випадок — вино за сортом)', () => {
    expect(matchProductNameToBaseRow('Вино біле сухе Kartuli Vazi Цинандалі')).toBeNull();
  });
  it('нічого не знайдено — null', () => {
    expect(matchProductNameToBaseRow('щось геть випадкове яке точно не в базі xyz987')).toBeNull();
  });
  it('порожня назва — null, не кидає', () => {
    expect(matchProductNameToBaseRow('')).toBeNull();
    expect(matchProductNameToBaseRow('   ')).toBeNull();
  });
});

// Реальні позиції з NUTRI-PANTRY-0922.json (переказ ГОЛОВНИЙ ЧАТ, етап 5).
// Після ребейзу на main (етап 4, #194, dbf7f0d) рядки бази для всіх існують.
// productLabel тут — `product + variant` (без бренду), як і реальний виклик
// у pantry-view.ts/services/api/src/nutrition.ts.
describe('matchProductNameToBaseRow: реальні позиції після ребейзу на етап 4 (#194)', () => {
  it('«томатна паста 25%» → рядок «Томатна паста 25%» (exact на повній фразі), не узагальнена «Томатна паста»', () => {
    const r = matchProductNameToBaseRow('томатна паста 25%');
    expect(r).toEqual({ protein: 4, fat: 0, carbs: 16.4, fiber: 0, source: 'label:chumak.com@2026-09-22' });
  });
});

// Етап 5-біс (§А): три рядки етапу 4 підводив keyword-маршрут в aliases.json
// (category+слово) — а keyword-гілка BaseMatcher.match() перевіряє
// item.categories, яких у продукту дому завжди [] (нема каталожних
// категорій), тож гілка не спрацьовувала ще ДО фільтра сильних правил.
// household_overrides (own поле, перевіряється в matchProductNameToBaseRow
// напряму, ще до виклику matcher.match()) — точна фраза продукту дому →
// рядок бази, в обхід keyword-гейта.
describe('matchProductNameToBaseRow: household_overrides — маршрутизація для назв продукту дому (§А)', () => {
  it('«оливки зелені Chupadedos» → «Оливки зелені в олії», не розсільні «Оливки зелені»', () => {
    const r = matchProductNameToBaseRow('оливки зелені Chupadedos');
    expect(r).toEqual({ protein: 1.2, fat: 22.6, carbs: 0, fiber: 0, source: 'label:elolivo.ie@2026-09-22' });
  });
  it('«оливки зелені мариновані Чупадедос» — той самий рядок, інша форма фрази з комори', () => {
    const r = matchProductNameToBaseRow('оливки зелені мариновані Чупадедос');
    expect(r?.source).toBe('label:elolivo.ie@2026-09-22');
  });
  it('«желе сухе апельсин» → «Желе суха суміш», не готове желе', () => {
    const r = matchProductNameToBaseRow('желе сухе апельсин');
    expect(r).toEqual({ protein: 9.9, fat: 0, carbs: 86, fiber: 0, source: 'label:metro.ua@2026-09-22' });
  });
  it('«желе сухе лісові ягоди» — той самий рядок, інший смак (смак на БЖВ сухої суміші не впливає)', () => {
    const r = matchProductNameToBaseRow('желе сухе лісові ягоди');
    expect(r?.source).toBe('label:metro.ua@2026-09-22');
  });
  it('«оливкова олія з трюфелем» → «Олія оливкова ароматизована», не extra virgin', () => {
    const r = matchProductNameToBaseRow('оливкова олія з трюфелем');
    expect(r).toEqual({ protein: 0, fat: 92, carbs: 0, fiber: 0, source: 'label:metro.ua@2026-09-22' });
  });
  it('«оливкова олія з базиліком» — той самий рядок, інший смак', () => {
    expect(matchProductNameToBaseRow('оливкова олія з базиліком')?.source).toBe('label:metro.ua@2026-09-22');
  });
  it('«оливкова олія Extra Virgin» (без ароматизації) — НЕ веде на ароматизовану: override — точна фраза, не підрядок', () => {
    const r = matchProductNameToBaseRow('оливкова олія Extra Virgin');
    expect(r?.source).not.toBe('label:metro.ua@2026-09-22');
  });
});

// Етап 5-біс (§Б): консерви із заливкою — рядок USDA описував інший стан
// продукту (детальніше в PR і в коментарі над відповідними рядками
// data/nutrition/base.csv). household_overrides веде на нові label:-рядки
// саме для householdа — стара позиція бази лишається на місці (для
// каталожного рівня, не чіпав).
describe('matchProductNameToBaseRow: консерви із заливкою (§Б)', () => {
  it('«тунець консервований у власному соку» — рядок замінено на реальну етикетку (rozetka.com.ua), не usda:173709', () => {
    const r = matchProductNameToBaseRow('тунець консервований у власному соку');
    expect(r).toEqual({ protein: 27, fat: 0.8, carbs: 0.7, fiber: 0, source: 'label:rozetka.com.ua@2026-09-22' });
  });
  it('«квасоля біла консервована» (WellDar) → рядок «з заливкою», не відціджена usda:175204', () => {
    const r = matchProductNameToBaseRow('квасоля біла консервована');
    expect(r).toEqual({ protein: 5, fat: 0.3, carbs: 6.8, fiber: 0, source: 'label:express.auchan.ua@2026-09-22' });
  });
  it('«квасоля консервована біла натуральна» (Metro Chef) → свій рядок «з заливкою»', () => {
    const r = matchProductNameToBaseRow('квасоля консервована біла натуральна');
    expect(r).toEqual({ protein: 6.6, fat: 0.5, carbs: 18.4, fiber: 0, source: 'label:metro.zakaz.ua@2026-09-22' });
  });
});
