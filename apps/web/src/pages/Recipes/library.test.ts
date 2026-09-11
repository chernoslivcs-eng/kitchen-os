import { describe, it, expect } from 'vitest';
import { filterCounts, matches, statusWord, rank } from './library';

// PLAN §8: лічильник рахує те, що під ним — у кожній пігулці своє число,
// «Усі» — усі. Слово стану в роді (D5), порядок «спершу те, що можна зараз».

const rs = [
  { status: 'ready' as const, cooked_count: 2 },
  { status: 'ready' as const, cooked_count: 0 },
  { status: 'near' as const, cooked_count: 1 },
  { status: 'far' as const, cooked_count: 0 },
];

describe('бібліотека рецептів', () => {
  it('лічильники фільтрів — кожен своє, «Усі» — усі; «Готував» перетинається зі станами', () => {
    expect(filterCounts(rs)).toEqual({ all: 4, ready: 2, near: 1, cooked: 2 });
    expect(rs.filter((r) => matches(r, 'cooked')).length).toBe(2);
    expect(filterCounts([])).toEqual({ all: 0, ready: 0, near: 0, cooked: 0 });
  });
  it('слово стану в роді', () => {
    expect(statusWord({ status: 'ready' })).toEqual({ text: 'можу зараз', tone: 'sage' });
    expect(statusWord({ status: 'near' })).toEqual({ text: 'майже', tone: 'amber' });
    expect(statusWord({ status: 'far' })).toEqual({ text: 'далеко', tone: 'far' });
  });
  it('порядок: можу зараз → майже → далеко', () => {
    expect([...rs].reverse().sort((a, b) => rank(a) - rank(b)).map((r) => r.status)).toEqual(['ready', 'ready', 'near', 'far']);
  });
});
