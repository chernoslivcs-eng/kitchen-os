import { describe, it, expect } from 'vitest';
import { legendLabel, legendIcon } from './legend';
import type { EventOccurrence } from '../../api';

// Чіп легенди (Screens D3): підпис звичайним регістром за правилами
// legendLabel, знак роду — сезон sun, традиція church, завіз truck, подія дому
// users, рамка дня без знака.

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();
const base = { scope: 'catalog', kind: 'season', force: 'hint' } as const;
const ev = (o: Partial<EventOccurrence>): EventOccurrence => ({ id: 'x', title: 'Помідори', start: day(2026, 7, 20), end: day(2026, 9, 30), ...base, ...o });

describe('legendLabel', () => {
  const today = day(2026, 9, 10);
  it('суворе — «день N з M», не капсом', () => {
    expect(legendLabel(ev({ title: 'Піст', force: 'restrict', start: day(2026, 8, 30), end: day(2026, 10, 14) }), today)).toBe('Піст · день 12 з 46');
  });
  it('сезон, що давно триває, — лише кінцем, «≈» коли дати рахуються', () => {
    expect(legendLabel(ev({ approx: true }), today)).toBe('Помідори · до ≈ 30.09');
    expect(legendLabel(ev({}), today)).toBe('Помідори · до 30.09');
  });
  it('щойно почалось — «з дня тижня · до»', () => {
    expect(legendLabel(ev({ title: 'Гарбуз', start: day(2026, 9, 7), end: day(2026, 11, 30), approx: true }), today)).toBe('Гарбуз · з пн 7 · до ≈ 30.11');
  });
  it('коротке (≤14 днів) — проміжком днів тижня', () => {
    expect(legendLabel(ev({ title: 'Мама', scope: 'household', kind: 'custom', start: day(2026, 9, 10), end: day(2026, 9, 13) }), today)).toBe('Мама · чт 10 – нд 13');
  });
});

describe('legendIcon', () => {
  it('рід → знак', () => {
    expect(legendIcon(ev({}))).toBe('live.season');
    expect(legendIcon(ev({ kind: 'tradition' }))).toBe('live.tradition');
    // 12.09: обмеження з каталогу (піст) — moon, стан; church лишається святу без обмеження.
    expect(legendIcon(ev({ kind: 'tradition', scope: 'catalog', force: 'restrict' }))).toBe('live.fast');
    expect(legendIcon(ev({ kind: 'supply', scope: 'household' }))).toBe('live.supply');
    expect(legendIcon(ev({ kind: 'custom', scope: 'household' }))).toBe('live.household');
    expect(legendIcon(ev({ kind: 'constraint', scope: 'household' }))).toBeNull();
  });
});
