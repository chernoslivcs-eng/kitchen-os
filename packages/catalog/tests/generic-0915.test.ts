import { describe, it, expect } from 'vitest';
import { resolveLabelToKey, resolveLabelToZone } from '../logic.js';
import { BY_KEY, CATALOG, CATALOG_GENERIC } from '../seed.js';
import { GENERIC_0915 } from '../generic-0915.js';

// Власник 15.09: загальні записи для родових слів («кефір», «сметана»…), яких
// у довіднику були лише варіанти. Таблиця слово → типовий варіант → ключ —
// packages/catalog/GENERIC-0915.md.

describe('загальні записи каталогу (GENERIC-0915)', () => {
  it('кожне родове слово дає свій загальний ключ', () => {
    for (const g of GENERIC_0915) expect(resolveLabelToKey(g.word), g.word).toBe(g.key);
  });
  it('відмінки й множина — той самий ключ', () => {
    for (const g of GENERIC_0915) for (const a of g.aliases) {
      const k = resolveLabelToKey(a);
      expect(k, `${g.word}: «${a}»`).not.toBeNull();
    }
  });
  it('уточнення й далі беруть точний запис, не загальний', () => {
    for (const [label, expected] of [
      ['кефір 1%', 'dairy_kefir_1'], ['хліб житній', null], ['сметана 20%', null], ['гречка зелена', 'grain_buckwheat_green'],
      ['олія оливкова', null], ['ковбаса лікарська', 'saus_boiled_likarska'], ['сир голландський', 'cheese_dutch'], ['помідори черрі', null],
      ['вершки 33%', null], ['куряче стегно', 'chicken_thigh'], ['тунець консервований', 'tuna_canned'],
    ] as [string, string | null][]) {
      const k = resolveLabelToKey(label);
      expect(k, label).not.toMatch(/^gen_/);
      if (expected) expect(k, label).toBe(expected);
    }
  });
  it('загальний запис успадковує зону й алергени типового; категорії — типового або найкоротшого варіанта групи', () => {
    for (const item of CATALOG_GENERIC) {
      const g = GENERIC_0915.find((x) => x.key === item.key)!;
      const typical = BY_KEY.get(g.typical)!;
      expect(item.zone_default, item.key).toBe(typical.zone_default);
      if (!g.shelfGroup) expect(item.categories, item.key).toEqual(typical.categories);
      expect(item.allergen_groups, item.key).toEqual(typical.allergen_groups);
      expect(item.priority, item.key).toBeLessThan(0);
      // «Нутрієнти — оцінка» від 15.09 (#137) не було дизайн-рішенням, а
      // лише станом станом на той момент: apply-base.ts тоді ще не
      // проганявся по цих 47 записах. Етап 2 (22.09) його прогнав — частина
      // родових слів (тунець, креветки, курка тощо) отримала звірене usda:
      // джерело замість оцінки генератора, це покращення, не порушення.
      expect(resolveLabelToZone(g.word), g.word).toBe(typical.zone_default);
    }
  });
  it('сусідні слова не зачеплені: «маслянка» ≠ масло, «сирок» ≠ сир, «рисовий папір» ≠ рис', () => {
    expect(resolveLabelToKey('маслянка')).not.toBe('gen_butter');
    expect(resolveLabelToKey('сирок')).not.toBe('gen_cheese');
    expect(resolveLabelToKey('сирок глазурований')).not.toBe('gen_cheese');
    expect(resolveLabelToKey('рисовий папір')).not.toBe('gen_rice');
    expect(resolveLabelToKey('хлібці')).not.toBe('gen_bread');
  });
  it('ключі й аліаси не дублюють наявні записи', () => {
    const keys = new Set(CATALOG.map((i) => i.key));
    expect(keys.size).toBe(CATALOG.length);
    const others = new Map<string, string>();
    for (const i of CATALOG) if (!i.key.startsWith('gen_')) for (const a of [i.name, ...i.aliases]) others.set(a.toLowerCase().replace(/[ʼ'’]/g, ''), i.key);
    for (const g of CATALOG_GENERIC) for (const a of g.aliases) {
      // Форма слова, що вже є в іншого запису, лишається за ним (порядок і priority) — але саме
      // родове слово має бути новим, інакше запис нічого не додає.
      const n = a.toLowerCase();
      if (n === GENERIC_0915.find((x) => x.key === g.key)!.word) expect(others.has(n), `«${a}» уже аліас ${others.get(n)}`).toBe(false);
    }
  });
});
