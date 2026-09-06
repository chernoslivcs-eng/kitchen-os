// Гебрейський календар: арифметика за Dershowitz & Reingold, «Calendrical
// Calculations» (алгоритм у суспільному надбанні). Жодних таблиць і жодних
// залежностей: @hebcal/core — GPL-2.0, а нам потрібні сім свят на пʼять років.
// Звірено з @hebcal/core 6.9.2 на 2026–2030 (occasion-table.test.ts).
//
// Дата тут — цивільний день свята (15 Нісана = 2 квіт. 2026). Свято починається
// ввечері напередодні; це рахує вже той, хто будує вікно (occasion-data.ts).

const HEBREW_EPOCH = -1373427;   // R.D. 1 Тішрея 1 року
const GREGORIAN_EPOCH = 1;

const floor = Math.floor;
const mod = (a: number, b: number) => a - b * floor(a / b);

// ── Григоріанський ↔ R.D. ──────────────────────────────────────────────────
function gregorianLeap(y: number): boolean {
  return mod(y, 4) === 0 && ![100, 200, 300].includes(mod(y, 400));
}

export function fixedFromGregorian(y: number, m: number, d: number): number {
  return GREGORIAN_EPOCH - 1 + 365 * (y - 1) + floor((y - 1) / 4) - floor((y - 1) / 100) + floor((y - 1) / 400)
    + floor((367 * m - 362) / 12) + (m <= 2 ? 0 : gregorianLeap(y) ? -1 : -2) + d;
}

function gregorianYearFromFixed(date: number): number {
  const d0 = date - GREGORIAN_EPOCH;
  const n400 = floor(d0 / 146097), d1 = mod(d0, 146097);
  const n100 = floor(d1 / 36524), d2 = mod(d1, 36524);
  const n4 = floor(d2 / 1461), d3 = mod(d2, 1461);
  const n1 = floor(d3 / 365);
  const year = 400 * n400 + 100 * n100 + 4 * n4 + n1;
  return n100 === 4 || n1 === 4 ? year : year + 1;
}

export function gregorianFromFixed(date: number): { y: number; m: number; d: number } {
  const y = gregorianYearFromFixed(date);
  const priorDays = date - fixedFromGregorian(y, 1, 1);
  const correction = date < fixedFromGregorian(y, 3, 1) ? 0 : gregorianLeap(y) ? 1 : 2;
  const m = floor((12 * (priorDays + correction) + 373) / 367);
  const d = date - fixedFromGregorian(y, m, 1) + 1;
  return { y, m, d };
}

export function isoFromFixed(date: number): string {
  const { y, m, d } = gregorianFromFixed(date);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ── Гебрейський ─────────────────────────────────────────────────────────────
export function hebrewLeapYear(y: number): boolean {
  return mod(7 * y + 1, 19) < 7;
}

function lastMonthOfHebrewYear(y: number): number {
  return hebrewLeapYear(y) ? 13 : 12;
}

function hebrewCalendarElapsedDays(y: number): number {
  const monthsElapsed = floor((235 * y - 234) / 19);
  const partsElapsed = 12084 + 13753 * monthsElapsed;
  const day = 29 * monthsElapsed + floor(partsElapsed / 25920);
  return mod(3 * (day + 1), 7) < 3 ? day + 1 : day;
}

function hebrewYearLengthCorrection(y: number): number {
  const ny0 = hebrewCalendarElapsedDays(y - 1);
  const ny1 = hebrewCalendarElapsedDays(y);
  const ny2 = hebrewCalendarElapsedDays(y + 1);
  if (ny2 - ny1 === 356) return 2;
  if (ny1 - ny0 === 382) return 1;
  return 0;
}

function hebrewNewYear(y: number): number {
  return HEBREW_EPOCH + hebrewCalendarElapsedDays(y) + hebrewYearLengthCorrection(y);
}

function daysInHebrewYear(y: number): number {
  return hebrewNewYear(y + 1) - hebrewNewYear(y);
}

function longMarheshvan(y: number): boolean {
  return [355, 385].includes(daysInHebrewYear(y));
}

function shortKislev(y: number): boolean {
  return [353, 383].includes(daysInHebrewYear(y));
}

export function lastDayOfHebrewMonth(y: number, m: number): number {
  if ([2, 4, 6, 10, 13].includes(m)) return 29;
  if (m === 12 && !hebrewLeapYear(y)) return 29;
  if (m === 8 && !longMarheshvan(y)) return 29;
  if (m === 9 && shortKislev(y)) return 29;
  return 30;
}

/** Місяці: 1 = Нісан … 7 = Тішрей … 12 = Адар (13 = Адар II у високосному). */
export function fixedFromHebrew(y: number, m: number, d: number): number {
  let days = hebrewNewYear(y) + d - 1;
  if (m < 7) {
    for (let k = 7; k <= lastMonthOfHebrewYear(y); k++) days += lastDayOfHebrewMonth(y, k);
    for (let k = 1; k < m; k++) days += lastDayOfHebrewMonth(y, k);
  } else {
    for (let k = 7; k < m; k++) days += lastDayOfHebrewMonth(y, k);
  }
  return days;
}

export type HebrewHoliday = 'purim' | 'pesach' | 'shavuot' | 'rosh' | 'yom-kippur' | 'sukkot' | 'hanukkah';

/**
 * Цивільна дата початку свята (перший день, не вечір напередодні) у вказаному
 * григоріанському році. Весняні свята належать гебрейському року, що почався
 * попередньої осені (Y + 3760), осінні — тому, що починається цієї осені (Y + 3761).
 */
export function hebrewHolidayDate(h: HebrewHoliday, gregorianYear: number): string {
  const spring = gregorianYear + 3760;
  const autumn = gregorianYear + 3761;
  switch (h) {
    case 'purim': return isoFromFixed(fixedFromHebrew(spring, lastMonthOfHebrewYear(spring), 14));
    case 'pesach': return isoFromFixed(fixedFromHebrew(spring, 1, 15));
    case 'shavuot': return isoFromFixed(fixedFromHebrew(spring, 3, 6));
    case 'rosh': return isoFromFixed(fixedFromHebrew(autumn, 7, 1));
    case 'yom-kippur': return isoFromFixed(fixedFromHebrew(autumn, 7, 10));
    case 'sukkot': return isoFromFixed(fixedFromHebrew(autumn, 7, 15));
    case 'hanukkah': return isoFromFixed(fixedFromHebrew(autumn, 9, 25));
  }
}
