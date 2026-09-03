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
  lasting.sort((a, b) => rank(a) - rank(b) || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  return { lasting, point };
}

/**
 * Порядок роду: обмеження → особиста → сезон → свято → редакційна.
 *
 * Він вирішує, хто ховається в «ЩЕ N», коли місця бракує. Обмеження не
 * ховається ніколи — це рамка, під якою будується решта. Редакційна ховається
 * завжди першою: у неї є автор, і голоснішою за свято вона бути не сміє.
 *
 * Спершу тут стояло просто «довші вище», і це давало протилежне задуманому:
 * сезонів одночасно чотири, вони найдовші, ліміт три — тож «мама привезе
 * цибулю» щоразу тонула, а зверху стояли самі сезони.
 */
export function rank(e: EventOccurrence): number {
  if (e.force === 'restrict') return 0;
  if (e.scope === 'household') return 1;
  if (e.kind === 'season') return 2;
  if (e.kind === 'editorial' || e.source) return 4;
  return 3;   // свято
}

/**
 * Скільки рисок показує мобільний і хто їх узагалі отримує.
 *
 * Редакційна тривала риски не отримує НІКОЛИ, навіть коли їх лише дві: вона
 * живе в рядку «тривають зараз» і має ім'я тільки там. Це та сама межа, що
 * підпис джерела й вимикач — привід не стає каналом непомітно.
 */
export const MOBILE_RAILS = 3;

export function railable(e: EventOccurrence): boolean {
  return !(e.kind === 'editorial' || !!e.source);
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


/**
 * Доріжки для рисок: кожна подія тримає СВОЮ смугу на всю свою довжину.
 *
 * Без цього лінії зигзагують: коли подія починається, вона входить у набір і
 * зсуває решту праворуч — на екрані це видно як злам. Тому смуга закріплюється
 * за подією один раз, а в дні, де подія не триває, її доріжка лишається
 * порожньою.
 *
 * Порядок роду вирішує, кому дістануться перші доріжки, а отже — хто взагалі
 * потрапить у видимі три: обмеження ніколи не ховається, редакційна риски не
 * отримує зовсім.
 */
export function assignLanes(lasting: EventOccurrence[]): Map<string, number> {
  const out = new Map<string, number>();
  const placed: { e: EventOccurrence; lane: number }[] = [];
  const ordered = [...lasting].filter(railable)
    .sort((a, b) => rank(a) - rank(b) || a.start - b.start);

  for (const e of ordered) {
    if (out.has(e.id)) continue;
    const taken = new Set(placed.filter((p) => overlaps(p.e, e)).map((p) => p.lane));
    let lane = 0;
    while (taken.has(lane)) lane++;
    out.set(e.id, lane);
    placed.push({ e, lane });
  }
  return out;
}

function overlaps(a: EventOccurrence, b: EventOccurrence): boolean {
  return dayStart(a.start) <= dayStart(b.end) && dayStart(a.end) >= dayStart(b.start);
}
