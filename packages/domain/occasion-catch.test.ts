import { describe, it, expect } from 'vitest';
import { catchesFor, yearInKitchen } from './occasion-catch.js';
import type { OccasionCatchRow } from './types.js';

const d = (m: number, day: number) => new Date(2026, m - 1, day, 18, 0);
const r = (t: string, ing: string[]) => ({ t, ing: ing.map((n) => ({ n })) });

describe('спіймане вікно', () => {
  it('різото з білими ловить сезон грибів', () => {
    // 10 вересня сезон білих триває, і «білі гриби» стоять у його buy.
    const hits = catchesFor(r('Різото з білими', ['білі гриби', 'рис арборіо']), d(9, 10));
    expect(hits.map((h) => h.occasion_id)).toContain('mushroom');
    expect(hits.find((h) => h.occasion_id === 'mushroom')?.by).toContain('гриби');
  });

  it('та сама страва поза сезоном нічого не ловить', () => {
    expect(catchesFor(r('Різото з білими', ['білі гриби']), d(1, 15))).toEqual([]);
  });

  it('страва без нічого зі списку вікна не ловить', () => {
    // Сезон триває, але паста з ним не має спільного — вікно лишається
    // непійманим, і це правильно.
    const hits = catchesFor(r('Карбонара', ['спагеті', 'бекон', 'яйця']), d(9, 10));
    expect(hits.map((h) => h.occasion_id)).not.toContain('mushroom');
  });

  it('відмінок не заважає: «грибний крем-суп» — це зерно сезону', () => {
    const hits = catchesFor(r('Грибний крем-суп', ['гриби', 'вершки']), d(9, 10));
    expect(hits.map((h) => h.occasion_id)).toContain('mushroom');
  });

  it('обмеження не ловиться — піст не досягнення, а рамка', () => {
    // 5 березня 2027 триває Великий піст; нут стоїть у його buy.
    const hits = catchesFor(r('Нут з томатами', ['нут', 'томати']), new Date(2027, 2, 20, 18, 0), ['orthodox']);
    expect(hits.map((h) => h.occasion_id)).not.toContain('lent');
  });

  it('свято ловиться лише тим, у кого воно є', () => {
    const dish = r('Печені яблука з медом', ['яблука', 'мед']);
    expect(catchesFor(dish, d(8, 19), []).map((h) => h.occasion_id)).not.toContain('spas');
    expect(catchesFor(dish, d(8, 19), ['orthodox']).map((h) => h.occasion_id)).toContain('spas');
  });
});

describe('рік на кухні', () => {
  const cc = (occasion_id: string, year: number): OccasionCatchRow => ({
    household_id: 'hh', occasion_id, year, caught_at: new Date(2026, 8, 10).toISOString(),
    by: 'грибами', run_id: null,
  });

  it('спіймане вікно позначене, пропущене — ні', () => {
    const strips = yearInKitchen(2026, [cc('mushroom', 2026)]);
    const mushroom = strips.find((s) => s.occasion_id === 'mushroom');
    expect(mushroom?.caught).toBe(true);
    expect(mushroom?.month).toBe(9);   // вікно 09-01…10-31 — старт у вересні
    expect(mushroom?.by).toBe('грибами');

    const tomato = strips.find((s) => s.occasion_id === 'tomato-day-2026');
    expect(tomato?.caught).toBe(false);
    expect(tomato?.by).toBeNull();
  });

  it('минулорічне спіймання не рахується за цей рік', () => {
    const strips = yearInKitchen(2026, [cc('mushroom', 2025)]);
    expect(strips.find((s) => s.occasion_id === 'mushroom')?.caught).toBe(false);
  });

  it('обмеження (піст) у рік не входить — не досягнення, а рамка', () => {
    const strips = yearInKitchen(2027, [], ['orthodox']);
    expect(strips.some((s) => s.occasion_id === 'lent')).toBe(false);
  });

  it('свято за традицією видно лише розпізнаній традиції', () => {
    expect(yearInKitchen(2026, []).some((s) => s.occasion_id === 'spas')).toBe(false);
    expect(yearInKitchen(2026, [], ['orthodox']).some((s) => s.occasion_id === 'spas')).toBe(true);
  });

  it('якір без вікна (лунар/солар) у рік не входить', () => {
    const strips = yearInKitchen(2026, [], ['islamic']);
    expect(strips.some((s) => s.occasion_id === 'ramadan' || s.title.toLowerCase().includes('рамадан'))).toBe(false);
  });
});
