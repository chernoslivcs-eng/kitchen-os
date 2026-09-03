import { describe, it, expect } from 'vitest';
import { buildDays, splitRunning, type CalendarRow } from './days';
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
