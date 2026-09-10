import { describe, it, expect } from 'vitest';
import {
  SOON_CUT_DAYS, FRESH_SOON_DAYS, FRESH_CHECK_DAYS, CONTEXT_URGENT_DAYS,
  freshness, isSoon, noTermReason, timeWord, hasScale, FRESHNESS_LABEL,
} from '../shelf-thresholds.js';

describe('пороги свіжості — одне місце (Р2)', () => {
  it('чотири числа названі, і кожне своє', () => {
    expect(SOON_CUT_DAYS).toBe(3);
    expect(FRESH_SOON_DAYS).toBe(5);
    expect(FRESH_CHECK_DAYS).toBe(1);
    expect(CONTEXT_URGENT_DAYS).toBe(7);
  });

  it('дві драбини НЕ збігаються — і це рішення, не баг', () => {
    // Партія на 4 дні: шкала вже каже «добігає», зріз її ще не бере.
    // Саме ця розбіжність і є те, що прототип мусить малювати двома каналами,
    // а не однією шкалою.
    expect(freshness(4)).toBe('soon');
    expect(isSoon(4)).toBe(false);
    expect(isSoon(3)).toBe(true);
  });
});

describe('стан рядка — чотири, не три (Р3)', () => {
  it('прострочене ≠ сьогодні', () => {
    expect(freshness(-9)).toBe('overdue');
    expect(freshness(-1)).toBe('overdue');
    expect(freshness(0)).toBe('check');
    // Те, що раніше було неможливо: обидва давали одне слово «сьогодні».
    expect(freshness(-9)).not.toBe(freshness(0));
  });

  it('шкала по межах', () => {
    expect(freshness(6)).toBe('good');
    expect(freshness(5)).toBe('soon');
    expect(freshness(1)).toBe('soon');
    expect(freshness(0)).toBe('check');
    expect(freshness(null)).toBe('good');
  });

  it('прострочене потрапляє у зріз «скоро зіпсується»', () => {
    expect(isSoon(-9)).toBe(true);
  });

  it('імена станів не вживають слова «свіже» — воно позначає ЗОНУ (Р22)', () => {
    for (const label of Object.values(FRESHNESS_LABEL)) {
      expect(label.toLowerCase()).not.toContain('свіж');
    }
    expect(FRESHNESS_LABEL.good).toBe('Добре');
  });
});

describe('порожній строк — дві різні речі', () => {
  it('каталог знає річ і сказав «не псується»', () => {
    expect(noTermReason('salt')).toBe('settled');
    expect(timeWord(null, 'salt')).toBe('не псується');
  });

  it('каталог річ не знає — строку нема кому порахувати', () => {
    expect(noTermReason(null)).toBe('unknown');
    expect(timeWord(null, null)).toBe('без категорії');
  });
});

describe('слово часу — чотири написання', () => {
  it('точна дата, коли її поставила людина', () => {
    expect(timeWord(9, 'milk', '14 вер')).toBe('до 14 вер');
  });

  it('перше слово часу без прикметника «свіже» (Р22)', () => {
    expect(timeWord(9, 'milk', '14 вер')).not.toContain('свіже');
  });

  it('розрахунок — з «≈»', () => {
    expect(timeWord(5, 'milk')).toBe('≈ ще 5 дн');
  });

  it('прострочене — числом, не фразою: воно лягає в tabular-nums', () => {
    expect(timeWord(-9, 'milk')).toBe('−9 дн');
    expect(timeWord(-1, 'milk')).toBe('−1 дн');
  });

  it('сьогодні й завтра — словами, бо числа тут читаються гірше', () => {
    expect(timeWord(0, 'milk')).toBe('сьогодні');
    expect(timeWord(1, 'milk')).toBe('1 день');
  });
});

describe('позиція без каталожного ключа (17% комори)', () => {
  it('строку не показує, навіть коли число є — воно з таблиці ЗОН', () => {
    // Виміряно на живому засіві: «Куряче філе» без ключа дістало 21 день від
    // зони `fridge` замість двох. Впевнене «≈ ще 21 дн» на сирому мʼясі гірше,
    // ніж тиха позначка «без категорії».
    expect(timeWord(21, null)).toBe('без категорії');
    expect(timeWord(1095, null)).toBe('без категорії');
    expect(hasScale(null)).toBe(false);
  });

  it('але рука людини старша за здогадку зони', () => {
    expect(timeWord(21, null, '14 вер')).toBe('до 14 вер');
  });

  it('з ключем усе як було', () => {
    expect(timeWord(21, 'chicken_fillet')).toBe('≈ ще 21 дн');
    expect(hasScale('chicken_fillet')).toBe(true);
  });
});
