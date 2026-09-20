// Календар v3 (приведення до каркасу Комори, рішення 19.09): чисті хелпери
// для «Сьогодні» і «Далі» — текст рядків, прогрес, дати, групування,
// знак рядка. Без React, щоб межі («що вважається стартом», «коли є рядок
// «кінець»», «який знак у рядка») перевірялись тестом.

import type { EventOccurrence, NowItem } from '../../api';
import { daysBetween, dedupeTitle, plural, todayIso } from '../../lib/period';
import { isLasting, spanDays } from '../../lib/spans';

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
/** «Жовтень» — називний, роздільник місяця в «Далі» (тепер — заголовок картки місяця). */
export function monthName(at: number): string {
  const m = new Date(at).toLocaleDateString('uk-UA', { month: 'long' });
  return m.charAt(0).toUpperCase() + m.slice(1);
}
function dayStartOf(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ── Знак рядка (приведення до Комори): тон крапки більше не носій типу —
// знак носій, колір один (muted), без розфарбовування. ────────────────────

type RowIcon = 'live.season' | 'live.fast' | 'live.tradition' | 'live.household' | 'live.supply' | 'cook.timer';

function iconFor(kind: string, scope: 'catalog' | 'household', strict: boolean | undefined, restricts: string | null | undefined): RowIcon {
  if (kind === 'season') return 'live.season';
  // Каталожне: піст/обмеження (restricts непорожній) — той самий знак, що
  // строга своя дієта (той самий зміст — «не можна»); свято без обмежень —
  // church.
  if (scope === 'catalog') return restricts ? 'live.fast' : 'live.tradition';
  if (kind === 'diet' && strict) return 'live.fast';
  if (kind === 'supply') return 'live.supply';
  if (kind === 'constraint') return 'cook.timer';
  return 'live.household';
}

/** Знак рядка «Сьогодні» — з NowItem (періоди й сезон). */
export function nowIcon(it: Pick<NowItem, 'kind' | 'source' | 'strict' | 'rule_text'>): RowIcon {
  return iconFor(it.kind, it.source === 'user' ? 'household' : 'catalog', it.strict, it.rule_text);
}
/** Знак рядка з EventOccurrence — точкові події «Сьогодні» й усі рядки «Далі». */
export function eventIcon(e: Pick<EventOccurrence, 'kind' | 'scope' | 'strict' | 'restricts'>): RowIcon {
  return iconFor(e.kind, e.scope, e.strict, e.restricts);
}

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

/** Праве значення рядка періоду: день з прогресу, інакше «до 21.09».
 *  (Лишається для підрядків розкритого «Сезону» — там дата, не діапазон.) */
export function nowWhen(it: Pick<NowItem, 'kind' | 'source' | 'from' | 'to' | 'approx'>, today = todayIso()): string {
  const p = nowProgress(it, today);
  if (p) return `${p.dayN}-й день з ${p.total}`;
  return `до ${it.approx ? '≈ ' : ''}${isoDdmm(it.to)}`;
}

/**
 * Колонка «період» рядка «Сьогодні» (живий стенд 20.09): «15.09 – 05.10»,
 * каталожне з приблизним кінцем — «20.09 – ≈21.09». Той самий діапазон,
 * що завжди був у даних (from/to), тепер — окремою колонкою, а не сховано
 * в одному рядку з прогресом.
 */
export function todayPeriodRange(it: Pick<NowItem, 'from' | 'to' | 'approx'>): string {
  return `${isoDdmm(it.from)} – ${it.approx ? '≈ ' : ''}${isoDdmm(it.to)}`;
}

/**
 * Права колонка (dim→ink, «дні») рядка-періоду «Сьогодні»: прогрес для
 * своєї дієти («6-й день з 21»), інакше повна довжина періоду («2 дні») —
 * каталожний піст/пост не має «свого» початку, але має відому тривалість.
 */
export function todayPeriodDays(it: Pick<NowItem, 'kind' | 'source' | 'from' | 'to'>, today = todayIso()): string {
  const p = nowProgress(it, today);
  if (p) return `${p.dayN}-й день з ${p.total}`;
  const total = daysBetween(it.from, it.to) + 1;
  return `${total} ${plural(total, ['день', 'дні', 'днів'])}`;
}

/**
 * Мета рядка-періоду «Сьогодні» (рішення власника 20.09): НАСЛІДОК для
 * кухні, не тип — лише в цій картці («Далі» несе тип/правило тим самим
 * рядком, `aheadMeta`, не наслідок — рішення власника той-таки, не
 * чіпати). Три роди: власний період (`source==='user'`) з `rule_text` —
 * сам текст правила («без молока, сирів, вершків», «калорійніше» — те
 * саме поле, без обробки); каталожний піст (`rule_text` непорожній — у
 * `NowItem` це те саме поле, що `EventOccurrence.restricts` після
 * `nowItemToEvent`) — той самий текст, пропущений через `dedupeTitle`
 * (не дублювати назву, якщо правило вже починається з неї — той самий
 * рецепт, що `PeriodArtifact.tsx`: `dedupeTitle(title, event.restricts)`);
 * каталожне свято без правила — `meaning` одним рядком (обрізає CSS
 * `.rmeta`, тут — без обробки).
 */
export function todayConsequence(it: Pick<NowItem, 'title' | 'source' | 'rule_text' | 'meaning'>): string | null {
  if (it.source === 'user') return it.rule_text?.trim() || null;
  if (it.rule_text?.trim()) return dedupeTitle(it.title, it.rule_text).rule;
  return it.meaning?.trim() || null;
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

/** Середня колонка (мета, dim): рід за kind, коли нема числа праворуч; з числом — нічого (число вже все каже). */
export function todayPointMeta(e: Pick<EventOccurrence, 'kind' | 'servings'>): string | null {
  if (e.servings != null) return null;
  return KIND_META[e.kind] ?? null;
}
/** Права колонка (термінна, ROW ANATOMY): «N осіб» — коли є гості, інакше нічого. */
export function todayPointRight(e: Pick<EventOccurrence, 'servings'>): string | null {
  if (e.servings != null) return `${e.servings} ${plural(e.servings, ['особа', 'особи', 'осіб'])}`;
  return null;
}

/**
 * Мета згорнутого рядка «Сезон» (другим рядком, живий стенд 19.09): лише
 * назви, без дат — дати з'являються в розкритих підрядках, повторювати їх
 * тут зайве. «пік овочевого сезону · сливи · виноград +4» — перші три,
 * решта «+N».
 */
export function seasonNames(seasons: NowItem[]): string | null {
  if (seasons.length === 0) return null;
  const shown = seasons.slice(0, 3).map((s) => s.title);
  const hidden = seasons.length - shown.length;
  return `${shown.join(' · ')}${hidden > 0 ? ` +${hidden}` : ''}`;
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

/**
 * Середня колонка (мета, dim): лише правило («калорійніше», «без мʼяса,
 * риби…») для тривалого-старту — дата пішла в окрему колонку «період»
 * (живий стенд 20.09: подія · період · дні, а не дата всередині мети);
 * рід за kind для одноденної без гостей; нічого — для рядка-кінця й
 * одноденної з гостями (число вже праворуч).
 */
export function aheadMeta(row: AheadRow): string | null {
  if (row.kind === 'end') return null;
  const e = row.event;
  if (isLasting(e)) return e.restricts ?? e.rule_text ?? null;
  return todayPointMeta(e);
}
/**
 * Колонка «період» — «30.09 – 30.10»: і для рядка-старту, і для рядка-
 * кінця (в обох — повний діапазон, не лише одна дата), лише для тривалих;
 * одноденні — null (колонка лишається порожньою, без рисок).
 */
export function aheadPeriod(row: AheadRow): string | null {
  const e = row.event;
  if (!isLasting(e)) return null;
  return `${ddmm(e.start)} – ${e.approx ? '≈ ' : ''}${ddmm(e.end)}`;
}
/** Права колонка (термінна, ROW ANATOMY): «31 день» — тривала; «кінець» — рядок-кінець; «6 осіб» — гості; інакше нічого. */
export function aheadRight(row: AheadRow): string | null {
  if (row.kind === 'end') return 'кінець';
  const e = row.event;
  if (isLasting(e)) {
    const n = spanDays(e);
    return `${n} ${plural(n, ['день', 'дні', 'днів'])}`;
  }
  return todayPointRight(e);
}
/** Чи права колонка несе кількість днів (ink) — тон різнить лічильник від «кінець»/«N осіб»/рангу (усі muted). */
export function aheadRightIsDays(row: AheadRow): boolean {
  return row.kind === 'start' && isLasting(row.event);
}

export interface MonthGroup { key: string; label: string; rows: AheadRow[] }

/** «Далі» — картка на місяць (приведення до Комори: zone-card на зону → zone-card на місяць). Порожніх карток нема — групи йдуть лише там, де є рядки. */
export function aheadMonthGroups(rows: AheadRow[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  let cur: MonthGroup | null = null;
  for (const row of rows) {
    const at = aheadRowDate(row);
    const d = new Date(at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!cur || cur.key !== key) {
      cur = { key, label: monthName(at), rows: [] };
      groups.push(cur);
    }
    cur.rows.push(row);
  }
  return groups;
}
