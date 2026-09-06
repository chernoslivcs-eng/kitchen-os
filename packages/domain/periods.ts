// Раунд 5, крок П1: періоди з правилом.
//
// Дві сутності, не одна. ДОВІДНИК (occasion-data.ts → occasion_catalog) —
// сезони й свята, спільні для всіх, читаються крізь ПІДПИСКУ дому: сезон і
// редакційне увімкнені, поки не відписались; свято традиції вимкнене, поки не
// підписались. Рядок підписки існує лише як відхилення від цього дефолту.
// ЗАПИСИ ДОМУ (HouseholdEventRow) — те, чого в довіднику нема: дієта на
// період, гості, своє свято.
//
// Тут живе все, що обидві сутності зшиває: видимі рядки довідника, «що зараз»
// одним списком, блок [ЗАРАЗ] для моделі, вето суворих періодів і таблиця
// дат наперед. Традиції як окреме поле користувача більше не існують:
// традиція — це підписка на її набір.

import {
  DAY, ruleActive, ruleWindow, occurrencesInRange, christianTradition,
  type Rule, type Tradition,
} from './occasion-rules.js';
import { BUILTIN_OCCASIONS, isWindowRow, type OccasionRow, type WindowOccasion } from './occasion-data.js';
import { activeOccasions, upcomingEvents, whenLabel, keyDateLines } from './occasions.js';
import type { HouseholdEventRow } from './types.js';
import { buildVetoIndex, categoryName, isCategory } from './veto-index.js';
import type { VetoRow } from './profile-text.js';
import { normalize } from '@kitchen/catalog';

// ── Підписка ────────────────────────────────────────────────────────────────

export interface OccasionSubscriptionRow {
  household_id: string;
  occasion_id: string;
  enabled: boolean;
  updated_at: string;
}

export type SubscriptionLike = Pick<OccasionSubscriptionRow, 'occasion_id' | 'enabled'>;

/** Дефолт без рядка: сезон і редакційне — увімкнено; свято традиції — вимкнено. */
export function subscriptionDefault(row: Pick<OccasionRow, 'type'>): boolean {
  return row.type !== 'tradition';
}

export function isSubscribed(row: OccasionRow, subs: SubscriptionLike[]): boolean {
  const hit = subs.find((s) => s.occasion_id === row.id);
  return hit ? hit.enabled : subscriptionDefault(row);
}

/** Довідник крізь підписку — те, що бачить цей дім. */
export function subscribedRows(rows: OccasionRow[], subs: SubscriptionLike[]): OccasionRow[] {
  return rows.filter((r) => isSubscribed(r, subs));
}

/** Традиції, на які дім підписаний: ті, чиї свята увімкнені. Порядок сталий. */
export function subscribedTraditions(rows: OccasionRow[]): Tradition[] {
  const ALL: Tradition[] = ['orthodox', 'catholic', 'islamic', 'jewish', 'secular'];
  const have = new Set(rows.map((r) => r.tradition).filter((t): t is Tradition => !!t));
  return ALL.filter((t) => have.has(t));
}

export type OccasionSet = Tradition | 'seasons';
export const OCCASION_SETS: readonly OccasionSet[] = ['orthodox', 'catholic', 'islamic', 'jewish', 'secular', 'seasons'];

/**
 * Набір для картки серії. Великдень не має традиції (дата залежить від
 * пасхалії дому), тож належить обом християнським наборам.
 */
export function occasionSet(rows: OccasionRow[], set: OccasionSet): OccasionRow[] {
  if (set === 'seasons') return rows.filter((r) => r.type === 'season' || r.type === 'editorial');
  return rows.filter((r) => r.tradition === set
    || (!r.tradition && r.type === 'tradition' && (set === 'orthodox' || set === 'catholic')));
}

// ── Записи дому ─────────────────────────────────────────────────────────────

export function isoDay(d: Date | number): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function parseIso(iso: string): Date {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Кількість днів від from до to включно. */
export function spanDays(from: string, to: string): number {
  return Math.max(1, Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / DAY) + 1);
}

/** Правило дому з дат: рядок від from до to включно — разова подія з тривалістю. */
export function ruleFromDates(from: string, to: string): Rule {
  const days = spanDays(from, to);
  return days > 1 ? { t: 'once', at: from, days } : { t: 'once', at: from };
}

/** Вікно запису: явні from/to, інакше з правила once. Тижневе — без вікна. */
export function eventWindow(e: Pick<HouseholdEventRow, 'rule' | 'from' | 'to'>): { from: string; to: string } | null {
  if (e.from) return { from: e.from, to: e.to ?? e.from };
  if (e.rule.t === 'once') {
    const to = new Date(parseIso(e.rule.at));
    to.setDate(to.getDate() + Math.max(1, e.rule.days ?? 1) - 1);
    return { from: e.rule.at, to: isoDay(to) };
  }
  return null;
}

export function eventLive(e: HouseholdEventRow, now: Date): boolean {
  if (e.done_at) return false;
  if (e.expires_at && new Date(e.expires_at).getTime() < now.getTime()) return false;
  return true;
}

/** Триває сьогодні: по датах, включно з обома кінцями. */
export function eventActive(e: HouseholdEventRow, now: Date): boolean {
  if (!eventLive(e, now)) return false;
  return ruleActive(e.rule, now, []);
}

// ── «Зараз» одним списком ───────────────────────────────────────────────────

export interface NowItem {
  kind: OccasionRow['type'] | HouseholdEventRow['kind'];
  title: string;
  from: string;
  to: string;
  rule_text?: string;
  strict: boolean;
  source: 'catalog' | 'user' | 'chat';
  occasion_id?: string;
  id?: string;
  approx?: boolean;
  meaning?: string;
  buy?: string[];
  servings?: number | null;
}

function windowOf(row: WindowOccasion, now: Date, trads: Tradition[]): { from: string; to: string; approx?: boolean } | null {
  const lo = new Date(now); lo.setHours(0, 0, 0, 0);
  const occ = occurrencesInRange(row.rule, lo, lo, trads).find((o) => o.start <= lo.getTime() && o.end >= lo.getTime());
  return occ ? { from: isoDay(occ.start), to: isoDay(occ.end), ...(occ.approx ? { approx: true } : {}) } : null;
}

/**
 * Активні сьогодні: приводи з довідника (уже крізь підписку) і записи дому,
 * одним контрактом. Суворе — першим, далі за кінцем.
 */
export function nowItems(rows: OccasionRow[], events: HouseholdEventRow[], now = new Date()): NowItem[] {
  const trads = subscribedTraditions(rows);
  const out: NowItem[] = [];
  for (const o of activeOccasions(now, trads, rows)) {
    const row = rows.find((r) => r.id === o.id);
    if (!row || !isWindowRow(row)) continue;
    const w = windowOf(row, now, trads);
    if (!w) continue;
    out.push({
      kind: row.type, title: row.title, from: w.from, to: w.to,
      ...(row.restricts ? { rule_text: row.restricts } : {}),
      strict: !!row.restricts, source: 'catalog', occasion_id: row.id,
      ...(w.approx ? { approx: true } : {}),
      meaning: row.meaning, ...(row.buy?.length ? { buy: row.buy } : {}),
    });
  }
  for (const e of events) {
    if (!eventActive(e, now)) continue;
    const w = eventWindow(e) ?? { from: isoDay(now), to: isoDay(now) };
    out.push({
      kind: e.kind, title: e.title, from: w.from, to: w.to,
      ...(e.rule_text ?? e.restricts ?? e.note ? { rule_text: (e.rule_text ?? e.restricts ?? e.note)! } : {}),
      strict: !!e.strict || e.force === 'restrict',
      source: e.source === 'chat' || e.source === 'model' ? 'chat' : 'user',
      id: e.id, ...(e.buy?.length ? { buy: e.buy } : {}),
      ...(e.servings != null ? { servings: e.servings } : {}),
    });
  }
  return out.sort((a, b) => Number(b.strict) - Number(a.strict) || a.to.localeCompare(b.to));
}

// ── Блок [ЗАРАЗ] ────────────────────────────────────────────────────────────

const MONTHS = ['січ.', 'лют.', 'бер.', 'квіт.', 'трав.', 'черв.', 'лип.', 'серп.', 'вер.', 'жовт.', 'лист.', 'груд.'];
const DOW = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const DOW_EVERY = ['неділі', 'понеділка', 'вівторка', 'середи', 'четверга', 'пʼятниці', 'суботи'];

export function shortDate(iso: string): string {
  const d = parseIso(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function dowDate(iso: string): string {
  const d = parseIso(iso);
  return `${DOW[d.getDay()]} ${shortDate(iso)}`;
}

const HORIZON_DAYS = 21;

export const NOW_HEADER = '[ЗАРАЗ] (що триває сьогодні і що стоїть у календарі, одним списком. «суворо» — на цей час як «Я не їм»: сам не пропонуй ні в стравах, ні в needs, ні в rescues; на пряме прохання — одне речення попередження і зроби; коли суворе змінило твою пропозицію, назви його одним словом у reply («у піст — нутовий плов»). «мʼяко» — враховуй у пропозиціях; на пряме прохання робиш без попередження. Id у дужках — щоб правити, закривати чи прибирати карткою event; плани без id — з довідника, їх не правиш)';

const NOW_TAIL = 'Сезони й свята — привід, а не обовʼязок: згадуй лише коли доречно, одним реченням усередині відповіді.'
  + ' Не починай розмову з календаря. Дати, яких тут немає, не вигадуй — скажи, що не знаєш.'
  + ' Ніколи не описуй, як улаштована твоя памʼять: ні «розпізнається», ні «заповнюється», ні «прийде автоматично» — людині це нічого не дає й звучить як відмовка.'
  + ' Суворе вище — виняток: воно діє, поки триває, і не залежить від доречності.';

function eventLine(e: HouseholdEventRow, now: Date): string {
  const id = e.id.slice(0, 8);
  let when = '';
  const w = eventWindow(e);
  if (w) {
    const today = isoDay(now);
    if (w.from <= today && w.to >= today) when = w.from === w.to ? 'сьогодні' : `до ${shortDate(w.to)}`;
    else when = w.from === w.to ? dowDate(w.from) : `з ${shortDate(w.from)} до ${shortDate(w.to)}`;
  } else if (e.rule.t === 'weekly') {
    when = `що${DOW_EVERY[e.rule.dow] ?? 'тижня'}`;
  }
  const rule = e.rule_text ?? e.restricts ?? e.note;
  // «на шістьох» у правилі й «на 6» із servings — одне й те саме двічі; порції лише без правила.
  const parts = [`[${id}] ${e.title}`, when, rule ?? null, e.servings && !rule ? `на ${e.servings}` : null,
    e.strict || e.force === 'restrict' ? 'суворо' : 'мʼяко'].filter(Boolean);
  return parts.join(' · ');
}

/**
 * Один блок замість [СЕЗОН І СВЯТА] і [ТВОЇ ПЛАНИ]: активне з довідника крізь
 * підписку і записи дому — активні й найближчі (21 день) — одним списком;
 * далі ПОПЕРЕДУ з довідника і КЛЮЧОВІ ДАТИ підписаних традицій. Порожньо —
 * порожній рядок, токени на «нічого особливого» не витрачаємо.
 */
export function serializeNow(rows: OccasionRow[], events: HouseholdEventRow[], now = new Date()): string {
  const trads = subscribedTraditions(rows);
  const items = nowItems(rows, events, now);
  const lines: string[] = [];
  const seenEvent = new Set<string>();
  for (const it of items) {
    if (it.source === 'catalog') {
      const row = rows.find((r) => r.id === it.occasion_id) as WindowOccasion | undefined;
      const parts = [
        it.title,
        `до ${shortDate(it.to)}${it.approx ? ' (орієнтовно, місячний календар)' : ''}`,
        it.rule_text ?? it.meaning ?? null,
        it.strict ? 'суворо' : 'мʼяко',
        row?.buy?.length ? `варто докупити: ${row.buy.join(', ')}` : null,
      ].filter(Boolean);
      lines.push(parts.join(' · '));
    } else if (it.id) {
      const e = events.find((x) => x.id === it.id);
      if (e) { lines.push(eventLine(e, now)); seenEvent.add(e.id); }
    }
  }
  // Плани дому попереду — у межах горизонту, за датою; тижневі — завжди.
  const lo = new Date(now); lo.setHours(0, 0, 0, 0);
  const hi = new Date(lo.getTime() + HORIZON_DAYS * DAY);
  const ahead = events
    .filter((e) => eventLive(e, now) && !seenEvent.has(e.id))
    .map((e) => ({ e, occ: occurrencesInRange(e.rule, lo, hi, []).find((o) => o.end >= lo.getTime()) }))
    .filter((x): x is { e: HouseholdEventRow; occ: NonNullable<typeof x.occ> } => !!x.occ)
    .sort((a, b) => a.occ.start - b.occ.start);
  for (const { e } of ahead) lines.push(eventLine(e, now));

  const parts: string[] = [];
  if (lines.length) parts.push(lines.join('\n'));
  const soon = upcomingEvents(now, trads, HORIZON_DAYS, rows).slice(0, 4);
  if (soon.length) {
    parts.push('ПОПЕРЕДУ: ' + soon.map((s) =>
      `${whenLabel(s.at, now.getTime())}: ${s.title}${s.approx ? ' (орієнтовно, місячний календар)' : ''}`).join('; '));
  }
  const keys = keyDateLines(now, trads, rows);
  if (keys.length) {
    parts.push('КЛЮЧОВІ ДАТИ (пораховані точно, називай упевнено; «орієнтовно» переказуй як орієнтовно):\n' + keys.join('\n'));
  }
  if (!parts.length) return '';
  return '\n\n' + NOW_HEADER + '\n' + parts.join('\n') + '\n' + NOW_TAIL;
}

// ── Вето суворих періодів ───────────────────────────────────────────────────

/** Рядки з категоріями вето для тексту правила («без мʼяса, молочного, яєць» → категорії). */
function rowsFromRuleText(text: string, label: string, user_id: string): VetoRow[] {
  return buildVetoIndex(user_id, 'no', text)
    .filter((r) => r.kind !== 'free')
    .map((r) => ({ ...r, label }));
}

/**
 * Вето на цей хід: активні суворі записи дому (strict) і суворі приводи
 * довідника (restricts) — крізь підписку, по датах. Мʼякі не йдуть. Рядки
 * мають field 'no': це «Я не їм» на період — на пряме прохання модель
 * попереджає й робить, як і з полем профілю.
 */
export function periodVetoRows(rows: OccasionRow[], events: HouseholdEventRow[], now = new Date(), user_id = 'period'): VetoRow[] {
  const out: VetoRow[] = [];
  const trads = subscribedTraditions(rows);
  for (const o of activeOccasions(now, trads, rows)) {
    const row = rows.find((r) => r.id === o.id);
    if (!row || !isWindowRow(row) || !row.restricts) continue;
    if (row.veto?.length) {
      for (const c of row.veto) {
        if (!isCategory(c)) continue;
        out.push({ user_id, field: 'no', kind: 'category', ref: categoryName(normalize(c)), label: row.title, allergy: false, subject: null });
      }
    } else {
      out.push(...rowsFromRuleText(row.restricts, row.title, user_id));
    }
  }
  for (const e of events) {
    if (!eventActive(e, now)) continue;
    if (!(e.strict || e.force === 'restrict')) continue;
    const text = e.rule_text ?? e.restricts;
    if (!text) continue;
    out.push(...rowsFromRuleText(text, e.title, user_id));
  }
  // Один рядок на категорію/продукт.
  return out.filter((r, i, arr) => arr.findIndex((x) => x.kind === r.kind && x.ref === r.ref) === i);
}

// ── Таблиця дат наперед ─────────────────────────────────────────────────────

export interface OccasionTableEntry {
  occasion_id: string;
  /** Для рядків без традиції, чия дата від неї залежить (Великдень) — за якою рахували. */
  tradition: Tradition | null;
  year: number;
  from: string;
  to: string;
  approx?: boolean;
}

export const TABLE_YEARS: readonly number[] = [2026, 2027, 2028, 2029, 2030];

/**
 * Дати кожного приводу довідника на роки таблиці. Модель сирих правил не
 * бачить — лише серіалізовані рядки з готовими датами; ця таблиця — те саме
 * для людини й для тесту «без дірок».
 */
export function buildOccasionTable(rows: OccasionRow[] = BUILTIN_OCCASIONS, years: readonly number[] = TABLE_YEARS): OccasionTableEntry[] {
  const out: OccasionTableEntry[] = [];
  for (const r of rows) {
    if (!isWindowRow(r)) continue;
    const trads: (Tradition | null)[] = r.rule.t === 'easter'
      ? (r.tradition ? [r.tradition] : ['orthodox', 'catholic'])
      : [null];
    for (const t of trads) {
      for (const year of years) {
        const w = ruleWindow(r.rule, year, t ? [t] : []);
        if (!w) continue;
        const end = w.end < w.start ? new Date(new Date(w.end).getFullYear() + 1, new Date(w.end).getMonth(), new Date(w.end).getDate()).getTime() : w.end;
        out.push({
          occasion_id: r.id, tradition: r.rule.t === 'easter' ? t : (r.tradition ?? null), year,
          from: isoDay(w.start), to: isoDay(end),
          ...(r.approx || r.rule.t === 'dates' && r.approx ? { approx: true } : {}),
        });
      }
    }
  }
  return out.sort((a, b) => a.occasion_id.localeCompare(b.occasion_id) || String(a.tradition).localeCompare(String(b.tradition)) || a.year - b.year);
}

/** Найближче вікно приводу від `now` (цього року, а якщо вже минуло — наступного). */
export function nextWindow(row: WindowOccasion, now: Date, trads: Tradition[]): { from: string; to: string; approx?: boolean } | null {
  const lo = new Date(now); lo.setHours(0, 0, 0, 0);
  const hi = new Date(lo.getTime() + 400 * DAY);
  const occ = occurrencesInRange(row.rule, lo, hi, trads.length ? trads : (row.tradition ? [row.tradition] : []))
    .find((o) => o.end >= lo.getTime());
  if (!occ) return null;
  return { from: isoDay(occ.start), to: isoDay(occ.end), ...(occ.approx ? { approx: true } : {}) };
}

/** Одним словом — що робить привід: піст, докупити, святкова вечеря. */
export function occasionWhat(row: OccasionRow): string {
  if (isWindowRow(row) && row.restricts) return 'піст';
  if (row.type === 'season') return 'сезон';
  if (isWindowRow(row) && row.buy?.length) return 'докупити';
  return 'святкова вечеря';
}

/** Рядок довідника за назвою людини («кавуни» → melon): стем-збіг зі словами назви. */
export function findOccasionByTitle(rows: OccasionRow[], text: string): OccasionRow | null {
  const stem = (w: string) => (w.length <= 4 ? w : w.slice(0, -2));
  const words = normalize(text).split(/[^\p{L}]+/u).filter((w) => w.length >= 3).map(stem);
  if (!words.length) return null;
  const exact = rows.find((r) => r.id === text.trim());
  if (exact) return exact;
  for (const r of rows) {
    const tw = normalize(r.title).split(/[^\p{L}]+/u).filter((w) => w.length >= 3).map(stem);
    if (tw.some((t) => words.some((w) => t.startsWith(w) || w.startsWith(t)))) return r;
  }
  return null;
}

export { christianTradition };
