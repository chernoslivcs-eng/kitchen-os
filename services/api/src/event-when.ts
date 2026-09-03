// «Коли» від моделі → правило з датою.
//
// Одне тверде правило всього календаря: **модель не рахує дати**. Вона
// передає або те, що людина сказала дослівно («12 вересня»), або відносне
// («за тиждень», «щовівторка») — а в абсолютну дату це перетворює сервер, від
// сьогодні.
//
// Підстава не теоретична. Промпт шість QA-прогонів обіцяв «дати свят я
// порахую сам» і вигадував їх: піст «2 березня», Великдень «19 квітня»
// замість 15 березня і 2 травня. Дозволивши моделі ПИСАТИ події, ми тим
// більше не даємо їй рахувати.

import type { Rule } from '@kitchen/domain';

export type EventWhen =
  | { date: string }        // людина назвала дату: '2026-09-12'
  | { rel: string }         // '+7d', '+2w', 'today', 'tomorrow'
  | { weekly: number };     // 0=нд … 6=сб

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const REL = /^\+(\d{1,3})([dw])$/;

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shift(now: Date, days: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + days);
  return iso(d);
}

/**
 * `null` — форма невідома. Мовчки підставляти «сьогодні» не можна: подія з
 * вигаданою датою гірша за відсутню, бо виглядає як факт.
 */
export function resolveWhen(when: unknown, now = new Date(), days?: number): Rule | null {
  if (!when || typeof when !== 'object') return null;
  const w = when as Record<string, unknown>;
  const span = days != null && Number.isFinite(days) && days >= 1 && days <= 366
    ? Math.floor(days)
    : undefined;

  if (typeof w.date === 'string') {
    if (!ISO.test(w.date)) return null;
    return span ? { t: 'once', at: w.date, days: span } : { t: 'once', at: w.date };
  }

  if (typeof w.rel === 'string') {
    const rel = w.rel.trim().toLowerCase();
    if (rel === 'today') return span ? { t: 'once', at: iso(now), days: span } : { t: 'once', at: iso(now) };
    if (rel === 'tomorrow') {
      const at = shift(now, 1);
      return span ? { t: 'once', at, days: span } : { t: 'once', at };
    }
    const m = REL.exec(rel);
    if (!m) return null;
    const n = Number(m[1]);
    const at = shift(now, m[2] === 'w' ? n * 7 : n);
    return span ? { t: 'once', at, days: span } : { t: 'once', at };
  }

  if (w.weekly != null) {
    const dow = Number(w.weekly);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) return null;
    return { t: 'weekly', dow };
  }

  return null;
}
