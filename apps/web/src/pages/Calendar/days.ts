// Стрічка днів для календаря. Без згортання: кожен день — рядок, тижні йдуть
// підряд (канвас «Календар — інтерфейс», 03.09: «дати зверху вниз, порожній
// день — просто порожній рядок»). Попередня версія збирала порожні дні в
// «тишу» — і на десктопі згорнула рік у один рядок, сховавши все попереду.
//
// Тут лише точкові події: тривалі йдуть окремою віссю (риски в жолобі й
// легенда), інакше піст на 48 днів дав би 48 рядків «Великий піст».

import type { EventOccurrence } from '../../api';
import { rank } from '../../lib/spans';

export const DAY = 86_400_000;

export interface TimelineDay {
  at: number;                // початок дня (локальний)
  events: EventOccurrence[]; // точкові події цього дня, за рангом
}

export interface TimelineWeek {
  start: number;             // понеділок, початок дня
  num: number;               // ISO-тиждень
  days: TimelineDay[];       // рівно 7
}

export function dayStart(t: number): number {
  const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime();
}

/** Понеділок тижня, що містить t. */
export function mondayOf(t: number): number {
  const d = new Date(dayStart(t));
  const dow = (d.getDay() + 6) % 7; // пн=0
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

/** Наступний день календарно — не +24h: перехід на зимовий час дав би зсув. */
export function nextDay(t: number): number {
  const d = new Date(t); d.setDate(d.getDate() + 1); return d.getTime();
}

export function isoWeek(t: number): number {
  const d = new Date(dayStart(t));
  // ISO: тиждень належить року, в якому його четвер.
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + 3);
  const firstThu = new Date(d.getFullYear(), 0, 4);
  const fday = (firstThu.getDay() + 6) % 7;
  firstThu.setDate(firstThu.getDate() - fday + 3);
  return 1 + Math.round((d.getTime() - firstThu.getTime()) / (7 * DAY));
}

/**
 * Тижні від `from` (вирівнюється до понеділка) на `weeks` тижнів уперед.
 * Точкова подія лягає в день свого початку.
 */
export function buildTimeline(point: EventOccurrence[], from: number, weeks: number): TimelineWeek[] {
  const byDay = new Map<number, EventOccurrence[]>();
  for (const e of point) {
    const k = dayStart(e.start);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(e);
  }
  for (const list of byDay.values()) list.sort((a, b) => rank(a) - rank(b));

  const out: TimelineWeek[] = [];
  let at = mondayOf(from);
  for (let w = 0; w < weeks; w++) {
    const days: TimelineDay[] = [];
    const start = at;
    for (let i = 0; i < 7; i++) {
      days.push({ at, events: byDay.get(at) ?? [] });
      at = nextDay(at);
    }
    out.push({ start, num: isoWeek(start), days });
  }
  return out;
}
