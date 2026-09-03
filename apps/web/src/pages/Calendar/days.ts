// Стрічка днів календаря.
//
// Календар тут — журнал, а не сітка: сьогодні зверху, далі вниз. Сітка завжди
// показує дірки, навіть коли просить їх не помічати; стрічці нема де їх
// показати. Тому порожні дні підряд згортаються в один рядок «тиша», і план
// лишається частковим за замовчуванням — без «заплановано 2 з 7» і без
// пунктирних рамок, що просять себе заповнити.

import type { EventOccurrence } from '../../api';

export interface DayRow {
  type: 'day';
  at: number;
  events: EventOccurrence[];
}

export interface QuietRow {
  type: 'quiet';
  from: number;
  to: number;
  days: number;
}

export type CalendarRow = DayRow | QuietRow;

/**
 * Що вже триває на момент відкриття — окремо від стрічки. Інакше сезон, який
 * почався три тижні тому, або зникає зі списку зовсім, або засмічує кожен
 * день. Показуємо його один раз, і кінцем: «до 31 жовт · ще 8 тижнів».
 */
export function splitRunning(
  events: EventOccurrence[],
  from: number,
): { running: EventOccurrence[]; stream: EventOccurrence[] } {
  const start = dayStart(from);
  const running: EventOccurrence[] = [];
  const stream: EventOccurrence[] = [];
  for (const e of events) {
    if (dayStart(e.start) < start) running.push(e);
    else stream.push(e);
  }
  running.sort((a, b) => a.end - b.end);
  return { running, stream };
}

function dayStart(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Подія стає в стрічку днем свого ПОЧАТКУ, а не кожним днем свого вікна.
 *
 * Перша версія розкладала по всіх днях — і живий прогін показав стіну: три
 * сезони, повторені девʼяносто разів. Сезон не належить дню; він належить
 * періоду, і в стрічці днів йому місце рівно там, де він починається
 * («сезон грибів — починається») і де закінчується. Те, що вже триває,
 * показує окремий блок «Триває» (див. splitRunning).
 *
 * Одиночний порожній день лишається рядком — він тримає ритм. Два й більше
 * підряд стають одним «тиша», бо десять порожніх рядків це не календар.
 */
export function buildDays(
  events: EventOccurrence[],
  from: number,
  days: number,
  now = Date.now(),
): CalendarRow[] {
  // Дні перебираються календарно, а не додаванням DAY: в останню неділю
  // жовтня доба коротша на годину, і арифметика в мілісекундах зсуває межі
  // днів. Той самий баг зловили в тижневому правилі домену.
  const stamps: number[] = [];
  for (const d = new Date(dayStart(from)); stamps.length < days; d.setDate(d.getDate() + 1)) {
    stamps.push(d.getTime());
  }
  const index = new Map(stamps.map((at, i) => [at, i]));
  const buckets: EventOccurrence[][] = stamps.map(() => []);

  for (const e of events) {
    const i = index.get(dayStart(e.start));
    if (i === undefined) continue;   // почалось до вікна — це «Триває»
    buckets[i]?.push(e);
  }

  const rows: CalendarRow[] = [];
  let quietFrom: number | null = null;
  let quietDays = 0;

  const flush = (until: number) => {
    if (quietFrom === null) return;
    if (quietDays === 1) rows.push({ type: 'day', at: quietFrom, events: [] });
    else rows.push({ type: 'quiet', from: quietFrom, to: until, days: quietDays });
    quietFrom = null;
    quietDays = 0;
  };

  for (let i = 0; i < days; i++) {
    const at = stamps[i]!;
    const dayEvents = buckets[i] ?? [];
    // Сьогодні не згортається ніколи, навіть порожнє. Без нижнього бара це
    // єдиний якір «де я в часі», і сховати його в «тиша · 5 дн.» означало б
    // відібрати єдину клітинку, яка щось стверджує.
    if (dayEvents.length === 0 && at !== dayStart(now)) {
      if (quietFrom === null) quietFrom = at;
      quietDays++;
      continue;
    }
    flush(stamps[i - 1] ?? at);
    rows.push({ type: 'day', at, events: dayEvents });
  }
  flush(stamps[days - 1]!);
  return rows;
}

export interface WeekRow {
  type: 'week';
  start: number;
  days: DayRow[];
}

export interface QuietWeeksRow {
  type: 'quiet-weeks';
  from: number;
  to: number;
  weeks: number;
}

export type CalendarWeek = WeekRow | QuietWeeksRow;

/**
 * Те саме, що buildDays, але зібране в тижні — вигляд для десктопу, де є
 * ширина на сім колонок. Тиждень починається з понеділка: український
 * тиждень, а не американський.
 *
 * Порожні тижні згортаються так само, як порожні дні у стрічці. Сітка сама
 * по собі показує дірки — тут вони згорнуті, і це єдиний спосіб не
 * перетворити «нічого не заплановано» на докір.
 */
export function buildWeeks(
  events: EventOccurrence[],
  from: number,
  days: number,
  now = Date.now(),
): CalendarWeek[] {
  // Відкочуємось до понеділка того тижня, у якому лежить `from`.
  const first = new Date(dayStart(from));
  const dow = (first.getDay() + 6) % 7;          // Пн = 0
  first.setDate(first.getDate() - dow);

  const total = Math.ceil((days + dow) / 7) * 7;
  const stamps: number[] = [];
  for (const d = new Date(first); stamps.length < total; d.setDate(d.getDate() + 1)) {
    stamps.push(d.getTime());
  }
  const index = new Map(stamps.map((at, i) => [at, i]));
  const buckets: EventOccurrence[][] = stamps.map(() => []);
  for (const e of events) {
    const i = index.get(dayStart(e.start));
    if (i === undefined) continue;
    buckets[i]?.push(e);
  }

  const out: CalendarWeek[] = [];
  let quietFrom: number | null = null;
  let quietCount = 0;

  const flushQuiet = (until: number) => {
    if (quietFrom === null) return;
    out.push({ type: 'quiet-weeks', from: quietFrom, to: until, weeks: quietCount });
    quietFrom = null;
    quietCount = 0;
  };

  for (let w = 0; w * 7 < total; w++) {
    const slice = stamps.slice(w * 7, w * 7 + 7);
    const weekDays: DayRow[] = slice.map((at, i) => ({
      type: 'day', at, events: buckets[w * 7 + i] ?? [],
    }));
    // Той самий якір, що у стрічці: тиждень із сьогодні лишається видимим.
    const hasToday = slice.includes(dayStart(now));
    const empty = weekDays.every((d) => d.events.length === 0) && !hasToday;
    if (empty) {
      if (quietFrom === null) quietFrom = slice[0]!;
      quietCount++;
      continue;
    }
    flushQuiet(slice[0]! - 1);
    out.push({ type: 'week', start: slice[0]!, days: weekDays });
  }
  flushQuiet(stamps[total - 1]!);
  return out;
}
