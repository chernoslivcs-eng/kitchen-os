// «Свіже і заморожене — один продукт, два життя» (Р161, PR 2).
// Комора власника: «шпинат Fine Life» у морозилці → veg_spinach_fresh,
// «лосось Metro Chef порційний» → salmon_fresh, «білі гриби Spela різані» →
// mush_porcini. Строк рятувала лише зона; тип «свіжий» і його строк — хибні.
//
// Правило: frozen-пара береться ЛИШЕ за маркером заморозки в мітці (з/м, с/м,
// в/м, зам., заморож., морож., frozen) АБО коли зона з чека/форми = freezer
// (ResolveCtx.zone). Інакше — свіже: «спливло раніше» дешевше, ніж «ще добре».
import { describe, expect, it } from 'vitest';
import { CATALOG, BY_KEY } from '../seed.js';
import { resolveLabelToKey, hasFrozenMarker } from '../logic.js';

const zone = (key: string | null) => (key ? BY_KEY.get(key)!.zone_default : null);

describe('frozen-пари в каталозі', () => {
  it('у кожної пари: frozen_of вказує на наявний ключ, зона freezer, категорія «заморожене», нутрієнти ті самі', () => {
    const pairs = CATALOG.filter((i) => i.frozen_of);
    expect(pairs.length).toBeGreaterThanOrEqual(14);
    for (const f of pairs) {
      const fresh = BY_KEY.get(f.frozen_of!);
      expect(fresh, `${f.key} → ${f.frozen_of}`).toBeDefined();
      expect(fresh!.zone_default, f.key).not.toBe('freezer');
      expect(f.zone_default, f.key).toBe('freezer');
      expect(f.categories, f.key).toContain('заморожене');
      if (fresh!.nutrition && f.nutrition) {
        expect([f.nutrition.protein, f.nutrition.fat, f.nutrition.carbs], f.key)
          .toEqual([fresh!.nutrition.protein, fresh!.nutrition.fat, fresh!.nutrition.carbs]);
      }
    }
    // Один свіжий — одна frozen-пара.
    const dup = pairs.map((p) => p.frozen_of).filter((k, i, a) => a.indexOf(k) !== i);
    expect(dup).toEqual([]);
  });
});

describe('маркер заморозки', () => {
  it.each([
    ['Шпинат Fine Life з/м 400г', true],
    ['Лосось с/м філе', true],
    ['Креветки Metro Chef 58/66 в/м очищ.', true],
    ['Гриби білі зам. 300г', true],
    ['Малина заморожена', true],
    ['Полуниця морожена', true],
    ['Frozen spinach', true],
    ['шпинат Fine Life', false],
    ['Морозиво пломбір', false],           // «морозиво» — не маркер
    ['Лосось охолоджений', false],
    ['Основа для піци Vici', false],
  ])('%s → %s', (label, want) => {
    expect(hasFrozenMarker(label)).toBe(want);
  });
});

describe('резолвер: свіже чи заморожене', () => {
  const cases: [string, string, 'freezer' | 'fridge' | 'fresh' | undefined][] = [
    // Комора власника — без маркера, без зони: свіже.
    ['шпинат Fine Life', 'veg_spinach_fresh', undefined],
    ['лосось Metro Chef порційний', 'salmon_fresh', undefined],
    // «Spela білі гриби» — стартовий запис із брендом власника, і він заморожений: бренд знає більше за мітку.
    ['білі гриби Spela різані', 'mushrooms_frozen', undefined],
    ['білі гриби Spela різані', 'mush_porcini', 'fridge'],
    ['основа для піци Vici', 'bread_dough_pizza', undefined],
    // Та сама мітка, зона freezer з картки/чека — frozen-пара.
    ['шпинат Fine Life', 'spinach_frozen', 'freezer'],
    ['лосось Metro Chef порційний', 'salmon_portioned_frozen', 'freezer'],
    ['білі гриби Spela різані', 'mushrooms_frozen', 'freezer'],
    ['білі гриби', 'mushrooms_frozen', 'freezer'],
    ['основа для піци Vici', 'frz_pizza_dough', 'freezer'],
    // Маркер у мітці — frozen-пара без зони.
    ['Шпинат Fine Life з/м 400г', 'spinach_frozen', undefined],
    ['Лосось с/м порційний', 'salmon_portioned_frozen', undefined],
    ['Гриби білі зам. 300г', 'mushrooms_frozen', undefined],
    ['Полуниця з/м 500г', 'berry_strawberry_frozen', undefined],
    ['Малина Сільпо заморожена', 'berry_raspberry_frozen', undefined],
    ['Броколі с/м', 'frz_broccoli', undefined],
    // Креветки: у каталозі і так freezer, «в/м» — маркер, ключ той самий.
    ['Креветки Metro Chef 58/66 в/м очищ.', 'shrimp_vannamei', undefined],
    // Маркер у мітці важить і при зоні fridge (людина написала «заморожена» — вірим).
    ['основа для піци заморожена', 'frz_pizza_dough', undefined],
    ['основа для піци заморожена', 'frz_pizza_dough', 'fridge'],
    // Явна зона НЕ freezer без маркера — свіже, навіть коли алiас вів на frozen.
    ['основа для піци Vici', 'bread_dough_pizza', 'fridge'],
    // Контроль: завжди-заморожене не «розморожується» зоною.
    ['Пельмені', 'frz_pelmeni', 'fridge'],
    ['Морозиво пломбір', 'frz_ice_cream_plombir', undefined],
    // Контроль: строк-незалежне не чіпаємо.
    ['Молоко Яготинське 2,5%', 'milk_cow_25', 'freezer'],
  ];
  it.each(cases)('%s [%s]', (label, key, z) => {
    expect(resolveLabelToKey(label, undefined, z ? { zone: z } : undefined)).toBe(key);
  });
  it('зона frozen-пари — freezer, свіжого — не freezer', () => {
    expect(zone(resolveLabelToKey('шпинат Fine Life'))).toBe('fresh');
    expect(zone(resolveLabelToKey('шпинат Fine Life', undefined, { zone: 'freezer' }))).toBe('freezer');
  });
});
