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
  it('exact без бренду взагалі — знаходить («Гірчиця»)', () => {
    const r = matchProductNameToBaseRow('Гірчиця');
    expect(r).toEqual({ protein: 3.74, fat: 3.34, carbs: 5.83, fiber: 4, sugars: 0.92, sodium_mg: 1104, source: 'usda:172234' });
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
// етап 5). Рядків бази для них щЕ нема — етап 4 додає паралельно в ІНШІЙ
// гілці (data/nutrition/base.csv не займаю). Скіп до ребейзу на main після
// мержу етапу 4 — тоді зняти .skip і звузити asserts до точних чисел, якщо
// потрібно. Орієнтовні значення — з «Кандидатів на правку»
// NUTRI-LABELS-REPORT-0922.md (ухвалені 22.09, можуть трохи відрізнятись від
// фінальних label-рядків).
describe.skip('matchProductNameToBaseRow: реальні позиції — ЧЕКАЄ рядків етапу 4 (зняти skip після ребейзу)', () => {
  it('«томатна паста Чумак 25%» → рядок з відсотком, не узагальнена «Томатна паста»', () => {
    const r = matchProductNameToBaseRow('томатна паста Чумак 25%');
    expect(r).not.toBeNull();
  });
  it('«оливки Iruela зелені Chupadedos» → «в олії» (≈1.2/22.6/0)', () => {
    const r = matchProductNameToBaseRow('оливки Iruela зелені Chupadedos');
    expect(r).not.toBeNull();
    expect(r!.fat).toBeGreaterThan(15); // «в олії» — жирні, не розсіл (розсіл ~1 г жиру)
    expect(r!.carbs).toBeLessThan(3);
  });
  it('«желе сухе Мрія» → суха суміш (≈9.9/0/86), не готове желе', () => {
    const r = matchProductNameToBaseRow('желе сухе Мрія');
    expect(r).not.toBeNull();
    expect(r!.carbs).toBeGreaterThan(50); // суха суміш — цукор концентровано; готове желе ~17
  });
  it('«олія Metro Chef з трюфелем» → ароматизована олія (≈0/92/0)', () => {
    const r = matchProductNameToBaseRow('олія Metro Chef з трюфелем');
    expect(r).not.toBeNull();
    expect(r!.fat).toBeGreaterThan(85);
  });
});
