import { describe, it, expect } from 'vitest';
import { buildTimeline, mondayOf, isoWeek, dayStart, DAY } from './days';
import type { EventOccurrence } from '../../api';

const ev = (day: string, title: string, extra: Partial<EventOccurrence> = {}): EventOccurrence => {
  const at = new Date(`${day}T00:00:00`).getTime();
  return { id: title, scope: 'household', kind: 'custom', title, start: at + 9 * 3600_000, end: at + 9 * 3600_000, force: 'hint', ...extra };
};

describe('стрічка днів', () => {
  it('починається з понеділка і не згортає порожні дні', () => {
    const from = new Date('2026-09-03T00:00:00').getTime(); // четвер
    const weeks = buildTimeline([], from, 2);
    expect(new Date(weeks[0]!.start).getDay()).toBe(1);           // понеділок
    expect(weeks[0]!.days).toHaveLength(7);
    expect(weeks.flatMap((w) => w.days)).toHaveLength(14);        // жодного «тиша»
    expect(weeks[0]!.days[3]!.at).toBe(dayStart(from));           // четвер на місці
  });

  it('подія лягає в день початку, кілька — за рангом (обмеження першим)', () => {
    const from = new Date('2026-09-07T00:00:00').getTime();
    const weeks = buildTimeline([
      ev('2026-09-09', 'гості'),
      ev('2026-09-09', 'піст', { scope: 'catalog', force: 'restrict' }),
    ], from, 1);
    const wed = weeks[0]!.days[2]!;
    expect(wed.events.map((e) => e.title)).toEqual(['піст', 'гості']);
  });

  it('перехід на зимовий час не зсуває дні', () => {
    // Останній тиждень жовтня 2026: переведення годинника 25.10.
    const from = new Date('2026-10-19T00:00:00').getTime();
    const weeks = buildTimeline([], from, 2);
    const days = weeks.flatMap((w) => w.days);
    for (let i = 1; i < days.length; i++) {
      const d = new Date(days[i]!.at);
      expect(d.getHours()).toBe(0);
      expect(new Date(days[i - 1]!.at).getDate() !== d.getDate()).toBe(true);
    }
  });

  it('ISO-тиждень: 29 грудня 2025 — тиждень 1 (2026)', () => {
    expect(isoWeek(new Date('2025-12-29T00:00:00').getTime())).toBe(1);
    expect(isoWeek(new Date('2026-09-03T00:00:00').getTime())).toBe(36);
    expect(mondayOf(new Date('2026-09-06T12:00:00').getTime())).toBe(new Date('2026-08-31T00:00:00').getTime());
    expect(DAY).toBe(86_400_000);
  });
});
