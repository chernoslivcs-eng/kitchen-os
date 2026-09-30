// Живий баг (скрін із проду): «окріп · 180 мл» у складі рецепту показувався
// як позиція, якої бракує — кошик, жовте виділення. Власник: «треба щоб
// окріп не був як товар, це ж гаряча вода».

import { describe, expect, it } from 'vitest';
import { isTapWater } from './tap-water';

describe('isTapWater', () => {
  it('так: голі слова, обидва апострофи, регістр не важить', () => {
    expect(isTapWater('вода')).toBe(true);
    expect(isTapWater('Вода')).toBe(true);
    expect(isTapWater('окріп')).toBe(true);
    expect(isTapWater('Окріп')).toBe(true);
    expect(isTapWater("кип'яток")).toBe(true);
    expect(isTapWater('кипʼяток')).toBe(true); // інший апостроф (U+02BC)
  });

  it('так: «вода» з уточненням зі закритого списку, порядок слів не важить', () => {
    const qualifiers = [
      'гаряча', 'холодна', 'тепла', "кип'ячена", 'крижана',
      'питна', 'фільтрована', 'проточна', 'з-під крана', 'кімнатної температури',
    ];
    for (const q of qualifiers) {
      expect(isTapWater(`вода ${q}`)).toBe(true);
      expect(isTapWater(`${q} вода`)).toBe(true);
      expect(isTapWater(`${q.toUpperCase()} ВОДА`.toLowerCase())).toBe(true);
    }
    // Живий сценарій із задачі: обидва порядки.
    expect(isTapWater('гаряча вода')).toBe(true);
    expect(isTapWater('вода гаряча')).toBe(true);
  });

  it('ні: вода з брендом, іншим уточненням, чи взагалі не вода', () => {
    expect(isTapWater('мінеральна вода')).toBe(false);
    expect(isTapWater('газована вода')).toBe(false);
    expect(isTapWater('кокосова вода')).toBe(false);
    expect(isTapWater('рожева вода')).toBe(false);
    expect(isTapWater('вода Моршинська')).toBe(false);
    expect(isTapWater('Evian')).toBe(false);
    expect(isTapWater('лід')).toBe(false);
    expect(isTapWater('молоко')).toBe(false);
  });

  it('ні: порожньо/відсутньо', () => {
    expect(isTapWater(undefined)).toBe(false);
    expect(isTapWater(null)).toBe(false);
    expect(isTapWater('')).toBe(false);
  });

  it('крайові пробіли й пунктуація не заважають', () => {
    expect(isTapWater('  окріп  ')).toBe(true);
    expect(isTapWater('окріп.')).toBe(true);
    expect(isTapWater('гаряча  вода')).toBe(true); // подвійний пробіл
  });
});
