// Календар v3 (спек 18.09, 2b): чисті хелпери для «Зараз діє» і «Попереду» —
// текст рядків, прогрес, дати. Без React, щоб межі («що показує прогрес»,
// «яка подія рахується як «попереду»») перевірялись тестом, а не очима.

import type { EventOccurrence, NowItem } from '../../api';
import { daysBetween, plural, todayIso } from '../../lib/period';
import { isLasting, spanDays } from '../../lib/spans';
import type { ToneKey } from '../../lib/tone';
import { toneOfNow } from '../../lib/period';

function isoParts(iso: string): [number, number, number] {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number);
  return [y, m, d];
}
/** «21.09» — форма дат в усьому екрані (К6), з ISO 'YYYY-MM-DD'. */
export function isoDdmm(iso: string): string {
  const [, m, d] = isoParts(iso);
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`;
}
export function isoDow(iso: string): string {
  const [y, m, d] = isoParts(iso);
  return new Date(y, m - 1, d).toLocaleDateString('uk-UA', { weekday: 'short' });
}
/** Те саме, з timestamp (EventOccurrence.start/end). */
export function ddmm(at: number): string {
  return new Date(at).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
}
export function dow(at: number): string {
  return new Date(at).toLocaleDateString('uk-UA', { weekday: 'short' });
}

export { toneOfNow };

// ── «Зараз діє» (GET /v1/now, уже відсортовано: суворі → мʼякі, найближчий кінець) ──

/**
 * Прогрес лише для власної дієти з датою початку (аудит 2.5, К8): у сезону
 * нема «свого» початку, а обмеження домовленості «скільки вже» не рахує.
 */
export function nowProgress(it: Pick<NowItem, 'kind' | 'source' | 'from' | 'to'>, today = todayIso()): { dayN: number; total: number; pct: number } | null {
  if (it.source !== 'user' || it.kind !== 'diet') return null;
  const total = daysBetween(it.from, it.to) + 1;
  if (total <= 1) return null;
  const dayN = Math.min(Math.max(daysBetween(it.from, today) + 1, 1), total);
  return { dayN, total, pct: Math.round((dayN / total) * 100) };
}

/** Праве значення рядка: день з прогресу, інакше «до 21.09». */
export function nowWhen(it: Pick<NowItem, 'kind' | 'source' | 'from' | 'to' | 'approx'>, today = todayIso()): string {
  const p = nowProgress(it, today);
  if (p) return `${p.dayN}-й день з ${p.total}`;
  return `до ${it.approx ? '≈ ' : ''}${isoDdmm(it.to)}`;
}

/** Підрядок: дата (коли є прогрес — інакше вона вже в when) + значення для раціону. */
export function nowSub(it: Pick<NowItem, 'kind' | 'source' | 'from' | 'to' | 'approx' | 'meaning' | 'rule_text'>, today = todayIso()): string | null {
  const p = nowProgress(it, today);
  const parts: string[] = [];
  if (p) parts.push(`до ${it.approx ? '≈ ' : ''}${isoDdmm(it.to)}`);
  const meaning = it.meaning ?? it.rule_text ?? null;
  if (meaning) parts.push(meaning);
  return parts.length ? parts.join(' · ') : null;
}

export const NOW_TONE_ICON: Record<ToneKey, string> = {
  restrict: 'live.fast', own: 'live.household', season: 'live.season', tradition: 'live.tradition', grey: 'live.household',
};

// ── «Попереду» (GET /v1/events, майбутнє: старт попереду або кінець того, що вже триває) ──

export interface AheadRow {
  event: EventOccurrence;
  /** Подія вже триває — рядок лише позначає її наближений кінець («останні дні»). */
  endingSoon: boolean;
}

function dayStartOf(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Майбутнє в діапазоні [today, horizon]: те, що ще не почалось (за стартом),
 * і те, що вже триває, але скінчиться в діапазоні (за кінцем — «останні
 * дні»). Готування дому (kind 'meal') — геть, це «Дім зараз» і чат (К3).
 */
export function aheadRows(events: EventOccurrence[], today: number, horizon: number): AheadRow[] {
  const out: AheadRow[] = [];
  for (const e of events) {
    if (e.kind === 'meal') continue;
    const s = dayStartOf(e.start);
    const en = dayStartOf(e.end);
    if (en < today || s > horizon) continue;
    if (s > today) { out.push({ event: e, endingSoon: false }); continue; }
    if (isLasting(e) && en > today) out.push({ event: e, endingSoon: true });
  }
  out.sort((a, b) => {
    const at = a.endingSoon ? a.event.end : a.event.start;
    const bt = b.endingSoon ? b.event.end : b.event.start;
    return at - bt;
  });
  return out;
}

/** «28.11 – 06.01 · 40 днів» — тривала (гейт no-glyphs забороняє «→» самим
 *  знаком — тире, як і в weekRange/legendLabel, той самий канал діапазону);
 *  «19.09 сб» — одноденна; «21.09 пн» — кінець того, що вже триває. */
export function aheadDateLabel(row: AheadRow): string {
  const { event: e, endingSoon } = row;
  if (endingSoon) return `${ddmm(e.end)} ${dow(e.end)}`;
  if (isLasting(e)) return `${ddmm(e.start)} – ${ddmm(e.end)} · ${spanDays(e)} ${plural(spanDays(e), ['день', 'дні', 'днів'])}`;
  return `${ddmm(e.start)} ${dow(e.start)}`;
}

/** Мета рядка: «останні дні» для того, що добігає; інакше обмеження/гості/примітка. */
export function aheadMeta(row: AheadRow): string | null {
  if (row.endingSoon) return 'останні дні';
  const e = row.event;
  if (e.restricts || e.rule_text) return e.restricts ?? e.rule_text ?? null;
  if (e.servings != null) return `${e.servings} ${plural(e.servings, ['особа', 'особи', 'осіб'])}`;
  return e.note ?? null;
}
