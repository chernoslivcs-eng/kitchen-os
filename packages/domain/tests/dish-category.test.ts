// Р1: іконка страви за назвою — скриптом. Фікстура — 50 реальних назв (див. note
// у fixtures/dish-titles.json), ціль ≥ 45/50; розбіжності друкуються, щоб їх
// було видно, а не лише «упало».
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dishCategory, normalizeDishTitle, DISH_CATEGORIES, type DishCategory } from '../dish-category.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(HERE, 'fixtures/dish-titles.json'), 'utf-8')) as { cases: [string, DishCategory | null][] };

describe('dishCategory · 50 реальних назв', () => {
  it('≥ 45/50 збігаються з очікуваним', () => {
    const miss = fx.cases.filter(([t, want]) => dishCategory(t) !== want).map(([t, want]) => `${t} → ${dishCategory(t)} (чекали ${want})`);
    if (miss.length) console.log('розбіжності:\n  ' + miss.join('\n  '));
    expect(fx.cases.length).toBeGreaterThanOrEqual(50);
    expect(fx.cases.length - miss.length).toBeGreaterThanOrEqual(45);
  });
  it('усі очікувані категорії — зі словника', () => {
    for (const [, want] of fx.cases) if (want) expect(DISH_CATEGORIES).toContain(want);
  });
});

describe('dishCategory · правила', () => {
  it('страва важливіша за інгредієнт: «паста з креветками» — pasta, «салат з куркою» — salad, «суп з лососем» — soup', () => {
    expect(dishCategory('Паста з креветками')).toBe('pasta');
    expect(dishCategory('Салат з куркою')).toBe('salad');
    expect(dishCategory('Суп з лососем')).toBe('soup');
    expect(dishCategory('Тост з лососем')).toBe('sandwich');
  });
  it('перше слово-страва виграє: «сирники з ягідним соусом» — pancake, не sauce', () => {
    expect(dishCategory('Сирники з ягідним соусом')).toBe('pancake');
    expect(dishCategory('Соус до сирників')).toBe('sauce');
  });
  it('інгредієнт: перший за порядком, коли назви страви нема', () => {
    expect(dishCategory('Куряче філе з овочами')).toBe('poultry');
    expect(dishCategory('Овочі з курячим філе')).toBe('veg');
    expect(dishCategory('Креветки в часниковому маслі')).toBe('seafood');
    expect(dishCategory('Дорадо в солі')).toBe('fish');
  });
  it('нормалізація: регістр, апострофи ʼ/\'/’, лапки', () => {
    expect(normalizeDishTitle("  МʼЯСО  по-французьки ")).toBe("м'ясо по-французьки");
    expect(dishCategory('М’ЯСО по-французьки')).toBe('meat');
    expect(dishCategory('«Цезар» з куркою')).toBe('salad');
  });
  it('англійські/італійські назви', () => {
    expect(dishCategory('Chicken curry')).toBe('stew');
    expect(dishCategory('Risotto ai funghi')).toBe('stew');
    expect(dishCategory('Tuna poke bowl')).toBe('sushi');
    expect(dishCategory('Smash burger')).toBe('burger');
  });
  it('не впізнав → null; порожнє → null', () => {
    expect(dishCategory('Щось смачне')).toBeNull();
    expect(dishCategory('')).toBeNull();
    expect(dishCategory('QA7 Тест шерингу')).toBeNull();
  });
});
