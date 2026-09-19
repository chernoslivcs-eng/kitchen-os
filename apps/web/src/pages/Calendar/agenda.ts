// Календар v3 (К9, рішення 19.09 «мінімум»): чисті хелпери для «Сьогодні» і
// «Далі» — текст рядків, прогрес, дати, групування. Без React, щоб межі
// («що вважається стартом», «коли є рядок «кінець»») перевірялись тестом.

import type { EventOccurrence, NowItem } from '../../api';
import { daysBetween, plural, todayIso } from '../../lib/period';
import { isLasting, spanDays } from '../../lib/spans';
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
/** Те саме, з timestamp (EventOccurrence.start/end). */
export function ddmm(at: number): string {
  return new Date(at).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
}
export function dow(at: number): string {
  return new Date(at).toLocaleDateString('uk-UA', { weekday: 'short' });
}
function dayStartOf(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export { toneOfNow };

// ── «Сьогодні» (GET /v1/now — стан; + точкові події дня з /v1/events) ──────

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

/** Праве значення рядка періоду: день з прогресу, інакше «до 21.09». */
export function nowWhen(it: Pick<NowItem, 'kind' | 'source' | 'from' | 'to' | 'approx'>, today = todayIso()): string {
  const p = nowProgress(it, today);
  if (p) return `${p.dayN}-й день з ${p.total}`;
  return `до ${it.approx ? '≈ ' : ''}${isoDdmm(it.to)}`;
}

/**
 * NowItem → EventOccurrence, щоб клік по рядку «Сьогодні» відкривав
 * PeriodEvent тим самим шляхом, що «Далі» (ГОЛОВНИЙ ЧАТ 18.09, п.2: «один
 * обробник для обох блоків»), навіть коли подію з якоїсь причини не
 * знайдено у вже завантаженому `events` (резервний шлях — основний,
 * `events.find`, дає той самий об'єкт; цей — гарантія, що клік ніколи не
 * мовчить і ніколи не падає в каталог).
 *
 * НЕ плутати `NowItem.source` ('catalog'|'user'|'chat' — ХТО завів подію)
 * з `EventOccurrence.source` (імʼя редакційного джерела) — це різні поля,
 * synthetic-об'єкт лишає друге незаповненим.
 */
export function nowItemToEvent(it: NowItem): EventOccurrence {
  const scope: EventOccurrence['scope'] = it.source === 'user' ? 'household' : 'catalog';
  const id = (it.source === 'user' ? it.id : it.occasion_id) ?? it.title;
  return {
    id, scope, kind: it.kind, title: it.title,
    start: Date.parse(it.from), end: Date.parse(it.to),
    force: it.strict ? 'restrict' : 'hint', strict: it.strict,
    from: it.from, to: it.to,
    ...(scope === 'catalog' ? { restricts: it.rule_text ?? null } : { rule_text: it.rule_text ?? null }),
    ...(it.meaning ? { meaning: it.meaning } : {}),
    ...(it.buy?.length ? { buy: it.buy } : {}),
    ...(it.servings != null ? { servings: it.servings } : {}),
    ...(it.approx ? { approx: true } : {}),
  };
}

/**
 * Рядки картки «Сьогодні» (К9): строгі періоди → точкові події дня → мʼякі
 * періоди → сезони окремо (одним рядком «Сезон», картка сама його малює).
 * `now` — уже відсортовано бекендом (суворі → мʼякі, найближчий кінець);
 * тут лише ділимо на групи, порядок усередині групи лишається.
 */
export function todayGroups(now: NowItem[]): { strict: NowItem[]; soft: NowItem[]; seasons: NowItem[] } {
  const periods = now.filter((it) => it.from !== it.to);
  return {
    strict: periods.filter((it) => it.kind !== 'season' && it.strict),
    soft: periods.filter((it) => it.kind !== 'season' && !it.strict),
    seasons: now.filter((it) => it.kind === 'season'),
  };
}

/** Точкові (одноденні) події дому, чий день — сьогодні: з /v1/events, не з /v1/now
 *  (own custom/meal/supply/constraint з датою — /v1/now їх не завжди різнить, а тут є servings/note). */
export function todayPointEvents(events: EventOccurrence[], today: number): EventOccurrence[] {
  return events.filter((e) => !isLasting(e) && dayStartOf(e.start) === today);
}

const KIND_META: Partial<Record<string, string>> = { constraint: 'рамка дня', supply: 'постачання' };

/** Права колонка рядка точкової події дня: «N осіб» (гості), рід за kind, інакше нічого. */
export function todayPointMeta(e: Pick<EventOccurrence, 'kind' | 'servings'>): string | null {
  if (e.servings != null) return `${e.servings} ${plural(e.servings, ['особа', 'особи', 'осіб'])}`;
  return KIND_META[e.kind] ?? null;
}

/** «Сезон: сливи (до 20.09), білі гриби, виноград +4» — перший з датою, далі імена, решта — «+N». */
export function seasonSummary(seasons: NowItem[], today = todayIso()): string | null {
  if (seasons.length === 0) return null;
  const [first, ...rest] = seasons;
  const shown = rest.slice(0, 2).map((s) => s.title);
  const hidden = rest.length - shown.length;
  const parts = [`${first!.title} (${nowWhen(first!, today)})`, ...shown].join(', ');
  return `Сезон: ${parts}${hidden > 0 ? ` +${hidden}` : ''}`;
}

// ── «Далі» (GET /v1/events, від завтра до горизонту) ───────────────────────

/** Горизонт «Далі»: кінець третього місяця після поточного (вересень → 31.12). */
export function aheadHorizon(today: number): number {
  const d = new Date(today);
  d.setDate(1);
  d.setMonth(d.getMonth() + 4, 0); // день 0 місяця +4 = останній день місяця +3
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface AheadRow {
  event: EventOccurrence;
  /** «start» — подія стартує в горизонті; «end» — кінець ВЛАСНОГО тривалого періоду. */
  kind: 'start' | 'end';
}

/**
 * «Далі» (К9): сезони — геть повністю (вони живуть лише в картці
 * «Сьогодні»), сьогоднішнє — геть (воно в «Сьогодні»). Рядок-старт — усе,
 * що починається завтра..horizon: власні одноденні, каталожні свята/пости,
 * власні періоди. Рядок-кінець — ОКРЕМО, лише для власних тривалих
 * періодів (scope household, from ≠ to), чий кінець потрапляє в горизонт —
 * байдуже, чи вони вже діють, чи теж стартують у горизонті (тоді подія
 * дає ОБИДВА рядки). Каталожні тривалі (пости) рядка-кінця не дають:
 * тривалість уже в меті рядка-старту.
 */
export function aheadRows(events: EventOccurrence[], today: number, horizon: number): AheadRow[] {
  const out: AheadRow[] = [];
  for (const e of events) {
    if (e.kind === 'season') continue;
    const s = dayStartOf(e.start);
    const en = dayStartOf(e.end);
    if (s > today && s <= horizon) out.push({ event: e, kind: 'start' });
    if (e.scope === 'household' && isLasting(e) && en > today && en <= horizon) out.push({ event: e, kind: 'end' });
  }
  out.sort((a, b) => {
    const at = a.kind === 'end' ? a.event.end : a.event.start;
    const bt = b.kind === 'end' ? b.event.end : b.event.start;
    return at - bt || Number(a.kind === 'end') - Number(b.kind === 'end');
  });
  return out;
}

/** Дата рядка — старт для «start», кінець для «end» (ліва колонка «Далі»). */
export function aheadRowDate(row: AheadRow): number {
  return row.kind === 'end' ? row.event.end : row.event.start;
}

/** Мета рядка: «кінець» для рядка-кінця; тривала-старт — «до <кінець> · N днів · <причина>»;
 *  одноденна — рід за kind/гості; каталожне свято без обмежень — нічого. */
export function aheadMeta(row: AheadRow): string | null {
  if (row.kind === 'end') return 'кінець';
  const e = row.event;
  if (isLasting(e)) {
    const n = spanDays(e);
    const extra = e.restricts ?? e.rule_text ?? null;
    return `до ${ddmm(e.end)} · ${n} ${plural(n, ['день', 'дні', 'днів'])}${extra ? ` · ${extra}` : ''}`;
  }
  return todayPointMeta(e);
}
