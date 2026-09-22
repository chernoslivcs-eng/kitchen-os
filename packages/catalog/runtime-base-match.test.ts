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

// Ці чотири — реальні позиції з NUTRI-PANTRY-0922.json (переказ ГОЛОВНИЙ ЧАТ,
// етап 5). Після ребейзу на main (етап 4, #194, dbf7f0d) рядки бази для всіх
// чотирьох існують — але працює лише той, до якого веде СИЛЬНЕ правило.
// productLabel тут — `product + variant` (без бренду), як і реальний виклик
// у pantry-view.ts/services/api/src/nutrition.ts.
describe('matchProductNameToBaseRow: реальні позиції після ребейзу на етап 4 (#194)', () => {
  it('«томатна паста 25%» → рядок «Томатна паста 25%» (exact на повній фразі), не узагальнена «Томатна паста»', () => {
    const r = matchProductNameToBaseRow('томатна паста 25%');
    expect(r).toEqual({ protein: 4, fat: 0, carbs: 16.4, fiber: 0, source: 'label:chumak.com@2026-09-22' });
  });

  // Ці три — НЕ спрацьовують, і це не недогляд стажу 5, а структурний наслідок
  // тієї ж причини, що вже описана в resolveNutrition (packages/domain/
  // nutrition.ts): етап 4 підвів до цих рядків не exact/override, а
  // keyword-маршрут в aliases.json (category+слово, `cat: "олія"`/`"желе"`/…).
  // Keyword-гілка BaseMatcher.match() перевіряє `item.categories` — а в
  // продукту дому categories завжди [] (нема каталожних категорій), тож
  // гілка не спрацьовує ще ДО фільтра сильних правил; сам фільтр (STRONG_RULES
  // без keyword) — друга, незалежна причина відмови. Щоб ці три запрацювали
  // за назвою продукту дому, потрібен `override`- або `alias`-запис у
  // aliases.json на конкретну фразу — цей файл поза межами стажу 5.
  it('«оливки зелені Chupadedos» → null (маршрут «в олії» — keyword по категорії, продукт дому категорій не має)', () => {
    expect(matchProductNameToBaseRow('оливки зелені Chupadedos')).toBeNull();
  });
  it('«желе сухе апельсин» → null (маршрут «суха суміш» — той самий keyword-по-категорії гейт)', () => {
    expect(matchProductNameToBaseRow('желе сухе апельсин')).toBeNull();
  });
  it('«оливкова олія з трюфелем» → null (маршрут «ароматизована» — той самий keyword-по-категорії гейт)', () => {
    expect(matchProductNameToBaseRow('оливкова олія з трюфелем')).toBeNull();
  });
});
