import { describe, it, expect } from 'vitest';
import { catchesFor } from './occasion-catch.js';

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
