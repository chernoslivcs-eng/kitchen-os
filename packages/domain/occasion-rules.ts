// Механіка дат календаря. Тут немає жодного свята — тільки правила, за якими
// дата рахується.
//
// Винесено з occasions.ts (Б2 плану календаря): поки двигун і дані лежали в
// одному файлі, список свят можна було змінити лише деплоєм. Ні дім зі своєю
// подією, ні адмінка з «днем томатів» туди не дотягувались. Механіка
// лишається чистою й тестованою, дані переїжджають у таблицю окремо.

export type Tradition = 'orthodox' | 'catholic' | 'islamic' | 'jewish';

export const DAY = 86400000;
// Ісламський рік коротший за сонячний, тож дати дрейфують назад.
export const LUNAR_YEAR = 354.367 * DAY;
export const SOLAR_YEAR = 365.25 * DAY;

/**
 * Шість форм однієї дати. Раніше кожна з них була окремою гілкою всередині
 * функцій; тепер це поле рядка, і рядок може прийти звідки завгодно.
 *
 * Перші чотири належать глобальному каталогу:
 * - `window` — фіксоване вікно MM-DD, працює щороку, може перетинати Новий рік
 * - `easter` — зсув у днях від Великодня обраної традиції
 * - `lunar`  — якір + дрейф місячного року (ісламські)
 * - `solar`  — якір + дрейф сонячного (юдейські)
 *
 * Останні дві — тільки дому:
 * - `once`   — разова дата, з опційною тривалістю
 * - `weekly` — день тижня, що повторюється
 */
export type Rule =
  | { t: 'window'; from: string; to: string }
  | { t: 'easter'; from: number; to: number }
  | { t: 'lunar'; base: number }
  | { t: 'solar'; base: number }
  // Дві форми, яких у глобальних свят немає й бути не може — вони належать
  // дому. `days` у разової не косметика: «мама привезе цибулю — тиждень
  // готуємо з нею» має тривалість, інакше привід гасне наступного ранку.
  | { t: 'once'; at: string; days?: number }
  | { t: 'weekly'; dow: number };

/** Одне входження правила у часі. `end` дорівнює `start` у подій без тривалості. */
export interface Occurrence {
  start: number;
  end: number;
  approx?: boolean;
}

// ── Пасхалія ────────────────────────────────────────────────────────────────
// Католицька — Meeus/Jones/Butcher. Православна — олександрійська пасхалія,
// порахована в юліанському й переведена в григоріанський (+13 діб; ця поправка
// вірна до 2100 року, далі стане +14).
export function easterDate(year: number, tradition: 'orthodox' | 'catholic'): Date {
  if (tradition === 'catholic') {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }
  const a = year % 4, b = year % 7, c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const julian = new Date(year, month - 1, day);
  julian.setDate(julian.getDate() + 13);
  return julian;
}

/**
 * За чиєю пасхалією рахувати, коли в домі кілька традицій. Католицька виграє —
 * не за старшинством, а тому що так поводився код від початку, і рухати це
 * рішення всередині рефакторингу не можна.
 */
export function christianTradition(trads: Tradition[]): 'orthodox' | 'catholic' | null {
  if (trads.includes('catholic')) return 'catholic';
  if (trads.includes('orthodox')) return 'orthodox';
  return null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function mdOf(date: Date): string {
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Мілісекунди для MM-DD у вказаному році. Локальний час, як і решта модуля. */
export function atMonthDay(md: string, year: number): number {
  const [m = 1, d = 1] = md.split('-').map(Number);
  return new Date(year, m - 1, d).getTime();
}

function shiftEaster(easter: Date, days: number): Date {
  const out = new Date(easter);
  out.setDate(out.getDate() + days);
  return out;
}

/** Чи триває правило просто зараз. Якорі вікна не мають — для них завжди false. */
export function ruleActive(rule: Rule, date: Date, trads: Tradition[]): boolean {
  if (rule.t === 'window') {
    const md = mdOf(date);
    // Вікно може перетинати Новий рік (12-20 → 01-07), тому дві гілки.
    return rule.from <= rule.to
      ? md >= rule.from && md <= rule.to
      : md >= rule.from || md <= rule.to;
  }
  if (rule.t === 'easter') {
    const trad = christianTradition(trads);
    if (!trad) return false;
    const e = easterDate(date.getFullYear(), trad);
    return date >= shiftEaster(e, rule.from) && date <= shiftEaster(e, rule.to);
  }
  if (rule.t === 'once') {
    const w = onceWindow(rule);
    return date.getTime() >= w.start && date.getTime() <= w.end;
  }
  if (rule.t === 'weekly') return date.getDay() === rule.dow;
  return false;
}

/** Початок доби за локальним часом — щоб порівняння днів не залежало від години. */
function dayStart(at: number | Date): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayEnd(at: number | Date): number {
  const d = new Date(at);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function onceWindow(rule: Extract<Rule, { t: 'once' }>): Occurrence {
  const [y = 1970, m = 1, d = 1] = rule.at.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + Math.max(1, rule.days ?? 1) - 1);
  return { start: dayStart(start), end: dayEnd(end) };
}

/**
 * Початок і кінець вікна у вказаному році — для стрічки «Попереду».
 * `null` для якорів: у них немає кінця, тільки дата.
 */
export function ruleWindow(
  rule: Rule,
  year: number,
  trads: Tradition[],
): { start: number; end: number } | null {
  if (rule.t === 'window') {
    return { start: atMonthDay(rule.from, year), end: atMonthDay(rule.to, year) };
  }
  if (rule.t === 'easter') {
    const trad = christianTradition(trads);
    if (!trad) return null;
    const e = easterDate(year, trad);
    return {
      start: shiftEaster(e, rule.from).getTime(),
      end: shiftEaster(e, rule.to).getTime(),
    };
  }
  return null;
}

/** k-те входження якоря. Для вікон — null. */
export function anchorAt(rule: Rule, k: number): number | null {
  if (rule.t === 'lunar') return rule.base + k * LUNAR_YEAR;
  if (rule.t === 'solar') return rule.base + k * SOLAR_YEAR;
  return null;
}

/**
 * Найближче майбутнє входження якоря. Шість рядків Рамадану на два роки
 * вперед — це шум, а не памʼять, тому шукаємо саме перше після `after`.
 */
export function nextAnchorAfter(rule: Rule, after: number, tries = 4): number | null {
  for (let k = 0; k < tries; k++) {
    const at = anchorAt(rule, k);
    if (at === null) return null;
    if (at > after) return at;
  }
  return null;
}

/**
 * Усі входження правила, що перетинають вікно [from, to].
 *
 * Це те, чого не вміли activeOccasions і upcomingEvents: перший відповідає
 * лише про «зараз», другий — лише про початки. Календарю треба інше питання —
 * «що припадає на цей тиждень», і відповідь на нього має бути одна для всіх
 * пʼяти форм дати, інакше екран знатиме про правила більше, ніж має.
 *
 * Перетин, а не входження всередину: сезон грибів триває два місяці, і тиждень
 * усередині нього — теж його тиждень.
 */
export function occurrencesInRange(
  rule: Rule,
  from: Date,
  to: Date,
  trads: Tradition[] = [],
): Occurrence[] {
  const lo = dayStart(from);
  const hi = dayEnd(to);
  const overlaps = (o: Occurrence) => o.start <= hi && o.end >= lo;
  const out: Occurrence[] = [];

  if (rule.t === 'once') {
    const w = onceWindow(rule);
    if (overlaps(w)) out.push(w);
    return out;
  }

  if (rule.t === 'weekly') {
    // Крок календарним днем, а не додаванням DAY: в останню неділю жовтня
    // доба коротша на годину, і арифметика в мілісекундах зсуває день тижня.
    // Живий прогін показав «26 ПН — у вівторок мало часу» саме через це.
    for (const d = new Date(lo); d.getTime() <= hi; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === rule.dow) out.push({ start: dayStart(d), end: dayEnd(d) });
    }
    return out;
  }

  if (rule.t === 'lunar' || rule.t === 'solar') {
    for (let k = 0; k < 40; k++) {
      const at = anchorAt(rule, k);
      if (at === null) break;
      if (at > hi) break;
      const o = { start: dayStart(at), end: dayEnd(at), approx: true };
      if (overlaps(o)) out.push(o);
    }
    return out;
  }

  // Вікно й Великдень повторюються щороку. Беремо рік до й рік після — вікно
  // може перетинати Новий рік (12-20 → 01-07), і тоді його початок лежить у
  // попередньому році відносно запиту.
  for (let y = from.getFullYear() - 1; y <= to.getFullYear() + 1; y++) {
    const w = ruleWindow(rule, y, trads);
    if (!w) continue;
    // Вікно через Новий рік: кінець порахований у тому ж році, тобто раніше
    // за початок. Переносимо його на рік уперед.
    const end = w.end < w.start ? atMonthDay((rule as { to: string }).to, y + 1) : w.end;
    const o = { start: dayStart(w.start), end: dayEnd(end) };
    if (overlaps(o)) out.push(o);
  }
  return out.sort((a, b) => a.start - b.start);
}
