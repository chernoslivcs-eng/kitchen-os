// Тривалі події: дві осі, які не змішуються.
//
// Живе в lib, а не в сторінці календаря, бо правило «що з тривалої підіймається
// в ЗАРАЗ» потрібне навігації так само, як екрану: блок у шухляді показує ті
// самі події, і розійтись їм не можна.
//
// Правило з макета (В5): тривале НЕ займає рядків у днях. Інакше піст на 48
// днів дав би сорок вісім рядків «Великий піст», і календар перестав би бути
// календарем. Тому тривалі йдуть окремою віссю — рейкою над сіткою на
// десктопі, рискою збоку на мобільному, — а в днях лишаються тільки точкові.
//
// Одна подія ніколи не в обох місцях. У день старту в рядку стоїть лише
// короткий моно-підпис («▮ ЧЕРЕМША · СЕЗОН ПОЧАВСЯ»), а сама смуга йде вздовж.

import type { EventOccurrence } from '../api';

const DAY = 86_400_000;

function dayStart(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Скільки календарних днів займає подія. Один день — точкова. */
export function spanDays(e: EventOccurrence): number {
  return Math.round((dayStart(e.end) - dayStart(e.start)) / DAY) + 1;
}

export function isLasting(e: EventOccurrence): boolean {
  return spanDays(e) > 1;
}

/** Ділить потік на дві осі. Ніщо не потрапляє в обидві. */
export function splitAxes(events: EventOccurrence[]): {
  lasting: EventOccurrence[];
  point: EventOccurrence[];
} {
  const lasting: EventOccurrence[] = [];
  const point: EventOccurrence[] = [];
  for (const e of events) (isLasting(e) ? lasting : point).push(e);
  // Довші — вище: рейка читається згори вниз від найтривалішого.
  lasting.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  return { lasting, point };
}

export interface WeekSpan {
  event: EventOccurrence;
  /** Колонки CSS-сітки, 1..8 — як `grid-column: from / to`. */
  from: number;
  to: number;
  /** Подія почалась до цього тижня — лівий край відкритий, без скруглення. */
  openLeft: boolean;
  /** І триває далі — відкритий правий. */
  openRight: boolean;
}

/**
 * Смуги тривалих подій у межах одного тижня. Тиждень задається понеділком.
 *
 * Обрізання по краях не косметика: подія на 48 днів має показати в кожному
 * тижні саме свій відрізок, а відкритий край — сказати, що вона триває далі.
 */
export function weekSpans(lasting: EventOccurrence[], weekStart: number): WeekSpan[] {
  const lo = dayStart(weekStart);
  const days: number[] = [];
  for (const d = new Date(lo); days.length < 7; d.setDate(d.getDate() + 1)) days.push(d.getTime());
  const hi = days[6]!;

  const out: WeekSpan[] = [];
  for (const e of lasting) {
    const s = dayStart(e.start);
    const t = dayStart(e.end);
    if (t < lo || s > hi) continue;
    const fromIdx = Math.max(0, days.findIndex((d) => d >= s));
    const toIdx = t >= hi ? 6 : days.findIndex((d) => d >= t);
    out.push({
      event: e,
      from: fromIdx + 1,
      to: (toIdx < 0 ? 6 : toIdx) + 2,
      openLeft: s < lo,
      openRight: t > hi,
    });
  }
  return out;
}

/** Чи триває подія в цей день — для риски збоку на мобільному. */
export function coversDay(e: EventOccurrence, at: number): boolean {
  const d = dayStart(at);
  return d >= dayStart(e.start) && d <= dayStart(e.end);
}

/**
 * Підпис тривалої в дні, де вона починається чи закінчується. У середині —
 * нічого: смуга вже все сказала, а повторений щодня підпис і є те, чого ми
 * уникаємо.
 */
export function edgeCaption(e: EventOccurrence, at: number): string | null {
  const d = dayStart(at);
  const kindWord = e.kind === 'season' ? 'СЕЗОН'
    : e.force === 'restrict' ? 'ОБМЕЖЕННЯ'
    : e.kind === 'supply' ? 'ЗАВІЗ'
    : 'ПОДІЯ';
  if (d === dayStart(e.start)) return `▮ ${e.title.toUpperCase()} · ${kindWord} ПОЧАВСЯ`;
  if (d === dayStart(e.end)) return `▮ ${e.title.toUpperCase()} · ОСТАННІЙ ДЕНЬ`;
  return null;
}

/**
 * Що з тривалої підіймається в «ЗАРАЗ»: перший день і останні три.
 * Піст на 48 днів не мовчить лише двічі — на вході й на виході; середина
 * нічого не змінює, і нагадувати про неї щодня означало б знецінити блок.
 */
export function bubblesToNow(e: EventOccurrence, now = Date.now()): boolean {
  if (!isLasting(e)) return true;
  const d = dayStart(now);
  if (d === dayStart(e.start)) return true;
  return dayStart(e.end) - d <= 2 * DAY && d <= dayStart(e.end);
}

/**
 * Дні, які мусять лишитись видимими попри порожнечу: краї тривалих. Без цього
 * початок сезону тоне в «тиша · 6 дн.», бо точкових подій того дня немає.
 */
export function edgeDays(lasting: EventOccurrence[]): Set<number> {
  const out = new Set<number>();
  for (const e of lasting) {
    out.add(dayStart(e.start));
    out.add(dayStart(e.end));
  }
  return out;
}

/** Ліміт «три» — і в рейці, і в дні: більше трьох це вже список, а не погляд. */
export const VISIBLE_LIMIT = 3;

/** «ЩЕ N» завжди називає першу приховану, щоб рядок не був порожнім числом. */
export function moreLabel(hidden: EventOccurrence[], withName = true): string | null {
  if (!hidden.length) return null;
  const n = hidden.length;
  if (!withName) return `ЩЕ ${n}`;
  return `ЩЕ ${n} · ${hidden[0]!.title.toUpperCase()}`;
}
