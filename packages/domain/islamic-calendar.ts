// Табличний (арифметичний) ісламський календар — «кувейтський» алгоритм,
// цикл 30 років з 11 високосними. Молодика він не спостерігає, тож справжня
// дата може відрізнятись на ±1 день; кожне вікно з нього несе approx: true.
// Алгоритм за Dershowitz & Reingold, epoch — цивільний (пʼятниця 16.07.622).

import { fixedFromGregorian, gregorianFromFixed, isoFromFixed } from './hebrew-calendar.js';

const ISLAMIC_EPOCH = 227015;
const floor = Math.floor;

export function fixedFromIslamic(y: number, m: number, d: number): number {
  return ISLAMIC_EPOCH - 1 + 354 * (y - 1) + floor((3 + 11 * y) / 30) + 29 * (m - 1) + floor(m / 2) + d;
}

export function islamicFromFixed(date: number): { y: number; m: number; d: number } {
  const y = floor((30 * (date - ISLAMIC_EPOCH) + 10646) / 10631);
  const priorDays = date - fixedFromIslamic(y, 1, 1);
  const m = floor((11 * priorDays + 330) / 325);
  const d = date - fixedFromIslamic(y, m, 1) + 1;
  return { y, m, d };
}

export type IslamicHoliday = 'ramadan' | 'eid-fitr' | 'eid-adha';

const DAY_OF: Record<IslamicHoliday, { m: number; d: number }> = {
  'ramadan': { m: 9, d: 1 },
  'eid-fitr': { m: 10, d: 1 },
  'eid-adha': { m: 12, d: 10 },
};

/**
 * Усі входження свята в григоріанському році (Рамадан у 2030 припадає двічі:
 * 5 січня і 26 грудня). Орієнтовно — ±1 день від спостережуваного молодика.
 */
export function islamicHolidayDates(h: IslamicHoliday, gregorianYear: number): string[] {
  const { m, d } = DAY_OF[h];
  const from = fixedFromGregorian(gregorianYear, 1, 1);
  const to = fixedFromGregorian(gregorianYear, 12, 31);
  const y0 = islamicFromFixed(from).y;
  const out: string[] = [];
  for (let y = y0; y <= y0 + 2; y++) {
    const at = fixedFromIslamic(y, m, d);
    if (at >= from && at <= to) out.push(isoFromFixed(at));
  }
  return out;
}

export { gregorianFromFixed };
