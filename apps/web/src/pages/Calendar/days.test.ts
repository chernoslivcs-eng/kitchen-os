import { describe, it, expect } from 'vitest';
import { buildDays, buildWeeks, splitRunning, type CalendarRow } from './days';
import type { EventOccurrence } from '../../api';

const DAY = 86_400_000;
const d0 = new Date('2026-09-10T00:00:00').getTime();

const ev = (start: number, end: number, title = 'подія'): EventOccurrence => ({
  id: title, scope: 'household', kind: 'custom', title,
  start, end, force: 'hint',
});

const kinds = (rows: CalendarRow[]) => rows.map((r) => r.type);

describe('стрічка днів', () => {
  it('порожній тиждень згортається в один рядок тиші', () => {
    const rows = buildDays([], d0, 7);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'quiet', days: 7 });
  });

  it('одиночний порожній день лишається днем — він тримає ритм', () => {
    const rows = buildDays([ev(d0, d0), ev(d0 + 2 * DAY, d0 + 2 * DAY)], d0, 3);
    expect(kinds(rows)).toEqual(['day', 'day', 'day']);
  });

  it('два і більше порожніх підряд стають тишею', () => {
    const rows = buildDays([ev(d0, d0), ev(d0 + 3 * DAY, d0 + 3 * DAY)], d0, 4);
    expect(kinds(rows)).toEqual(['day', 'quiet', 'day']);
    expect((rows[1] as { days: number }).days).toBe(2);
  });

  it('подія з тривалістю стає ОДИН раз — днем свого початку', () => {
    // Перша версія розкладала по всіх днях, і живий прогін дав стіну: три
    // сезони, повторені девʼяносто разів. Сезон належить періоду, не дню.
    const rows = buildDays([ev(d0, d0 + 2 * DAY, 'сезон')], d0, 4);
    expect(kinds(rows)).toEqual(['day', 'quiet']);
    expect((rows[0] as { events: unknown[] }).events).toHaveLength(1);
  });

  it('подія, що почалась до вікна, у стрічку не потрапляє — вона «Триває»', () => {
    const rows = buildDays([ev(d0 - 5 * DAY, d0 + DAY, 'триває')], d0, 3);
    expect(kinds(rows)).toEqual(['quiet']);
  });

  it('splitRunning ділить на те, що вже йде, і те, що попереду', () => {
    const { running, stream } = splitRunning(
      [ev(d0 - 5 * DAY, d0 + 30 * DAY, 'сезон'), ev(d0 + DAY, d0 + DAY, 'гості')],
      d0,
    );
    expect(running.map((e) => e.title)).toEqual(['сезон']);
    expect(stream.map((e) => e.title)).toEqual(['гості']);
  });

  it('хвіст тиші закривається', () => {
    const rows = buildDays([ev(d0, d0)], d0, 5);
    expect(kinds(rows)).toEqual(['day', 'quiet']);
    expect((rows[1] as { days: number }).days).toBe(4);
  });
});

describe('тижні для десктопу', () => {
  it('тиждень починається з понеділка', () => {
    // 10.09.2026 — четвер; тиждень має початись 7-го, у понеділок.
    const weeks = buildWeeks([ev(d0, d0)], d0, 7);
    const first = weeks.find((w) => w.type === 'week') as { start: number };
    expect(new Date(first.start).getDay()).toBe(1);
  });

  it('порожні тижні згортаються, як і порожні дні', () => {
    const weeks = buildWeeks([ev(d0, d0)], d0, 28);
    expect(weeks[0]?.type).toBe('week');
    expect(weeks[1]?.type).toBe('quiet-weeks');
  });

  it('у тижні завжди сім днів, навіть коли подій нема', () => {
    const weeks = buildWeeks([ev(d0, d0)], d0, 7);
    const week = weeks.find((w) => w.type === 'week') as { days: unknown[] };
    expect(week.days).toHaveLength(7);
  });

  it('подія лягає у свій день тижня', () => {
    const weeks = buildWeeks([ev(d0, d0, 'гості')], d0, 7);
    const week = weeks.find((w) => w.type === 'week') as { days: { at: number; events: unknown[] }[] };
    const withEvents = week.days.filter((x) => x.events.length > 0);
    expect(withEvents).toHaveLength(1);
    expect(new Date(withEvents[0]!.at).getDay()).toBe(4);   // четвер
  });
});

describe('сьогодні не згортається', () => {
  it('порожній сьогоднішній день лишається рядком', () => {
    // Живий прогін показав гірше: тиждень із сьогодні згорнувся в «тиша», і
    // єдиний якір «де я в часі» зник з екрана взагалі.
    const rows = buildDays([ev(d0 + 5 * DAY, d0 + 5 * DAY)], d0, 7, d0);
    expect(rows[0]).toMatchObject({ type: 'day', at: d0 });
    expect((rows[0] as { events: unknown[] }).events).toHaveLength(0);
  });

  it('порожній тиждень із сьогодні лишається тижнем', () => {
    const weeks = buildWeeks([ev(d0 + 20 * DAY, d0 + 20 * DAY)], d0, 28, d0);
    expect(weeks[0]?.type).toBe('week');
  });

  it('інші порожні дні й тижні згортаються, як і раніше', () => {
    const rows = buildDays([], d0, 7, d0 - 100 * DAY);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('quiet');
  });
});

describe('краї тривалих не згортаються', () => {
  it('порожній день із початком тривалої лишається рядком', () => {
    // Інакше «▮ ЧЕРЕМША · СЕЗОН ПОЧАВСЯ» нема куди покласти, і початок сезону
    // тоне в «тиша · 6 дн.».
    const keep = new Set([d0 + 3 * DAY]);
    const rows = buildDays([], d0, 7, d0 - 100 * DAY, keep);
    expect(rows.map((r) => r.type)).toEqual(['quiet', 'day', 'quiet']);
    expect((rows[1] as { at: number }).at).toBe(d0 + 3 * DAY);
  });
});
