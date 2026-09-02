import { describe, expect, it } from 'vitest';
import { groupShopping, sourceLabel } from './shopping-groups';
import type { ShoppingItem } from '../../api';

const item = (o: Partial<ShoppingItem>): ShoppingItem => ({
  id: o.id ?? 'i', household_id: 'h', label: o.label ?? 'кава', reason: null,
  value: null, unit: null, zone: null, checked: o.checked ?? false,
  added_by: null, source: o.source ?? 'user',
  created_at: o.created_at ?? '2026-09-02T07:00:00Z',
});

const SESSION = '2026-09-02T06:59:00Z';

describe('groupShopping', () => {
  it('купленe йде вниз і не рахується в «до купівлі»', () => {
    const g = groupShopping([
      item({ id: 'a', checked: true }),
      item({ id: 'b' }),
    ], SESSION);
    expect(g.bought.map((i) => i.id)).toEqual(['a']);
    expect(g.toBuy).toBe(1);
  });

  // Межа групи — початок сесії, а не «останні N хвилин». Дельта має сенс
  // саме в межах розмови, у якій її додали.
  it('додане в цій сесії — «щойно», раніше — «раніше»', () => {
    const g = groupShopping([
      item({ id: 'old', created_at: '2026-09-01T20:00:00Z' }),
      item({ id: 'new', created_at: '2026-09-02T07:10:00Z' }),
    ], SESSION);
    expect(g.fresh.map((i) => i.id)).toEqual(['new']);
    expect(g.earlier.map((i) => i.id)).toEqual(['old']);
  });

  it('куплене не потрапляє в «щойно», навіть якщо додане щойно', () => {
    const g = groupShopping([item({ id: 'x', checked: true, created_at: '2026-09-02T07:10:00Z' })], SESSION);
    expect(g.fresh).toEqual([]);
    expect(g.bought.map((i) => i.id)).toEqual(['x']);
  });

  // Без сесії (історія, перше завантаження) нічого не «щойно»: підсвічувати
  // всі позиції як свіжі означало б збрехати про те, що змінилось.
  it('без сесії — усе в «раніше»', () => {
    const g = groupShopping([item({ id: 'a' }), item({ id: 'b' })], null);
    expect(g.fresh).toEqual([]);
    expect(g.earlier).toHaveLength(2);
  });

  it('порожній список — порожні групи, нуль до купівлі', () => {
    expect(groupShopping([], SESSION)).toEqual({ fresh: [], earlier: [], bought: [], toBuy: 0 });
  });
});

describe('sourceLabel', () => {
  it('три джерела, як у брифі', () => {
    expect(sourceLabel(item({ source: 'recipe' }))).toBe('З РЕЦЕПТА');
    expect(sourceLabel(item({ source: 'user' }))).toBe('РУЧНА');
    expect(sourceLabel(item({ source: 'model' }))).toBe('З ЧЕКА');
  });
  // retail і model обидва означають «прийшло з чека»: одне з мережі,
  // друге з розбору в чаті. Для людини це та сама історія.
  it('retail і model кажуть людині одне й те саме', () => {
    expect(sourceLabel(item({ source: 'retail' }))).toBe(sourceLabel(item({ source: 'model' })));
  });
});
