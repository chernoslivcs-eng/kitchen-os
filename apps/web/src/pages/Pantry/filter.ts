// Раунд 5, крок Ф1: фільтр комори — логіка перенесена один в один зі спеки
// design/PANTRY-FILTER-v2.dc.html (<script data-dc-script>): SORTS, CUTS,
// pass(), row(), порожні стани, «скинути». Чиста функція над списком, який уже
// прийшов з GET /v1/pantry; сервер нічого не фільтрує.

import type { PantryBatch, HouseholdProduct } from '../../api';
import { batchMatchesQuery } from '../../lib/recipe';
import { formatQty } from '../../lib/units';
import { plural } from '../../lib/plural';

export type SortKey = 'zone' | 'fresh' | 'kcal' | 'fat' | 'prot' | 'carb' | 'added';
export type KindKey = 'meat' | 'fish' | 'veg' | 'dairy' | 'drink';
export type StateKey = 'soon' | 'receipt' | 'no';
export type CutKey = KindKey | StateKey;
export type Tone = 'fg' | 'dim' | 'amber' | 'plum' | 'sage' | 'danger';

// Крок Ф2: одна вісь іконок — свіжість. Пороги в одному місці:
// зріз «скоро зіпсується» — ≤ SOON_CUT_DAYS; іконка — своя шкала:
// «добігає» від FRESH_SOON_DAYS до FRESH_CHECK_DAYS днів, «перевірити» —
// сьогодні або термін вийшов, інакше «свіже» (без терміну — теж свіже).
export const SOON_CUT_DAYS = 3;
export const FRESH_SOON_DAYS = 5;
export const FRESH_CHECK_DAYS = 1;
export type Freshness = 'fresh' | 'soon' | 'check';
export function freshness(days: number | null | undefined): Freshness {
  if (days == null || days > FRESH_SOON_DAYS) return 'fresh';
  if (days >= FRESH_CHECK_DAYS) return 'soon';
  return 'check';
}

export interface FilterState { sort: SortKey; cuts: CutKey[]; q: string }
export const INITIAL: FilterState = { sort: 'zone', cuts: [], q: '' };

export const ZONE_OPTIONS: { value: PantryBatch['zone']; label: string }[] = [
  { value: 'fresh', label: 'Свіже' },
  { value: 'fridge', label: 'Холодильник' },
  { value: 'freezer', label: 'Морозилка' },
  { value: 'dry', label: 'Суха шафа' },
  { value: 'spices', label: 'Спеції' },
  { value: 'drinks', label: 'Напої' },
];
export const UNIT_OPTIONS: { value: PantryBatch['unit']; label: string }[] = [
  { value: null, label: '—' },
  { value: 'g', label: 'г' },
  { value: 'ml', label: 'мл' },
  { value: 'pcs', label: 'шт' },
  { value: 'pack', label: 'пач' },
];


export const ZONE_ORDER: PantryBatch['zone'][] = ['fresh', 'fridge', 'freezer', 'dry', 'spices', 'drinks'];
export const ZONE_LABEL: Record<PantryBatch['zone'], string> = {
  fresh: 'Свіже', fridge: 'Холодильник', freezer: 'Морозилка', dry: 'Суха шафа', spices: 'Спеції', drinks: 'Напої',
};

const days = (it: PantryBatch) => (it.days == null ? 999 : it.days);
const num = (v: number | null | undefined) => (v == null ? null : v);
const approx = (it: PantryBatch) => (it.est ? '≈' : '');
// Позиція без БЖВ (нема в каталозі) — у кінці списку і без значення в колонці.
// Крок Ф2: значення шкали — цілі («46 г», «0 г»); «≈» лишається на оцінках.
const grams = (it: PantryBatch, v: number | null | undefined) => (v == null ? '' : `${approx(it)}${Math.round(v)} г`);

interface SortDef {
  key: SortKey; label: string;
  /** Ключ порядку; null — значення нема, така позиція йде в кінець. */
  by?: (it: PantryBatch) => number | null;
  val?: (it: PantryBatch) => string;
  unit?: string; head?: string;
  /** Скорочення заголовка там, де повний не влазить («вугл. / 100 г»). */
  unitShort?: string;
  color?: (it: PantryBatch) => Tone;
}
export const SORTS: SortDef[] = [
  { key: 'zone', label: 'за місцем' },
  { key: 'fresh', label: 'за свіжістю', by: (it) => days(it), val: (it) => (it.days == null ? '—' : it.days <= 0 ? 'сьогодні' : it.days === 1 ? '1 день' : `${it.days} дн`), unit: 'лишилось', color: (it) => (it.days != null && it.days <= 3 ? 'amber' : 'dim'), head: 'найшвидше зіпсується — зверху' },
  { key: 'kcal', label: 'за калорійністю', by: (it) => (it.kcal == null ? null : -it.kcal), val: (it) => (it.kcal == null ? '' : `${approx(it)}${Math.round(it.kcal)} ккал`), unit: 'ккал / 100 г', unitShort: 'ккал / 100 г', color: () => 'fg', head: 'від ситного до легкого' },
  { key: 'fat', label: 'за жирністю', by: (it) => (it.fat == null ? null : -it.fat), val: (it) => grams(it, it.fat), unit: 'жиру / 100 г', unitShort: 'жиру / 100 г', color: () => 'fg', head: 'від жирного до нежирного' },
  { key: 'prot', label: 'за білком', by: (it) => (it.prot == null ? null : -it.prot), val: (it) => grams(it, it.prot), unit: 'білка / 100 г', unitShort: 'білка / 100 г', color: () => 'fg', head: 'від білкового до небілкового' },
  { key: 'carb', label: 'за вуглеводами', by: (it) => (it.carb == null ? null : -it.carb), val: (it) => grams(it, it.carb), unit: 'вуглеводів / 100 г', unitShort: 'вугл. / 100 г', color: () => 'fg', head: 'від вуглеводного до безвуглеводного' },
  { key: 'added', label: 'за датою', by: (it) => num(it.added), val: (it) => (it.added == null ? '' : it.added <= 2 ? 'позавчора' : `${it.added} дн тому`), unit: 'додано', color: () => 'dim', head: 'нове зверху' },
];

interface CutDef { key: CutKey; label: string; tone: Tone; group?: boolean; test: (it: PantryBatch) => boolean }
export const CUTS: CutDef[] = [
  { key: 'soon', label: 'скоро зіпсується', tone: 'amber', test: (it) => it.days != null && it.days <= SOON_CUT_DAYS },
  { key: 'receipt', label: 'з останнього чека', tone: 'sage', test: (it) => !!it.receipt },
  { key: 'no', label: 'не їм / не можна', tone: 'plum', test: (it) => !!it.no },
  { key: 'meat', label: 'мʼясне', tone: 'fg', group: true, test: (it) => ['мʼясо', 'ковбаси'].includes(it.cat ?? '') },
  { key: 'fish', label: 'рибне', tone: 'fg', group: true, test: (it) => it.cat === 'риба' },
  { key: 'veg', label: 'овочеве', tone: 'fg', group: true, test: (it) => ['овочі', 'зелень і бобові'].includes(it.cat ?? '') },
  { key: 'dairy', label: 'молочне', tone: 'fg', group: true, test: (it) => ['молочне', 'сири', 'яйця'].includes(it.cat ?? '') },
  { key: 'drink', label: 'напої', tone: 'fg', group: true, test: (it) => ['напої', 'алкоголь', 'кава й чай'].includes(it.cat ?? '') },
];
const isGroup = (k: CutKey) => !!CUTS.find((c) => c.key === k)?.group;

const EMPTY_TITLE: Record<string, string> = {
  soon: 'Нічого не горить', receipt: 'З останнього чека все зʼїли', no: 'Усе в коморі — твоє',
  meat: 'Мʼясного нема', fish: 'Рибного нема', veg: 'Овочів нема', dairy: 'Молочного нема', drink: 'Напоїв нема',
};

const MONTHS = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// ----- переходи стану (як у дизайні) -----
export function toggleKind(st: FilterState, key: KindKey): FilterState {
  const on = st.cuts.includes(key);
  return { ...st, cuts: on ? st.cuts.filter((k) => k !== key) : [...st.cuts.filter((k) => !isGroup(k)), key] };
}
export function stateFull(st: FilterState, key: StateKey): boolean {
  return !st.cuts.includes(key) && st.cuts.filter((k) => !isGroup(k)).length >= 2;
}
export function toggleState(st: FilterState, key: StateKey): FilterState {
  if (stateFull(st, key)) return st;
  const on = st.cuts.includes(key);
  return { ...st, cuts: on ? st.cuts.filter((k) => k !== key) : [...st.cuts, key] };
}
export const resetFilter = (st: FilterState): FilterState => ({ ...st, sort: 'zone', cuts: [] });

// ----- пошук: назва партії, продукт/аліаси каталогу і назва категорії -----
export function passQuery(it: PantryBatch, q: string, productsById: Map<string, HouseholdProduct>): boolean {
  if (!q) return true;
  if ((it.cat ?? '').toLowerCase().includes(q)) return true;
  return batchMatchesQuery(q, it, productsById);
}

export function byAddedThenName(a: PantryBatch, b: PantryBatch): number {
  return b.added_at.localeCompare(a.added_at) || a.label.localeCompare(b.label, 'uk');
}

export function sortItems(items: PantryBatch[], sort: SortDef): PantryBatch[] {
  if (!sort.by) return items;
  const by = sort.by;
  return [...items].sort((a, b) => {
    const x = by(a), y = by(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;      // без значення — у кінець
    if (y == null) return -1;
    return x - y;
  });
}

export interface RowView {
  it: PantryBatch;
  name: string; qty: string; zone: string;
  sub: string; subTone: Tone;
  /** Іконка ліворуч — лише свіжість (крок Ф2); «не їм / не можна» — тільки підрядок. */
  fresh: Freshness;
  val: string; valTone: Tone;
}

export interface FilterView {
  sort: SortDef;
  shown: PantryBatch[];
  dirty: boolean;
  meta: string;
  grouped: boolean;
  groups: { zone: PantryBatch['zone']; label: string; count: number; items: RowView[] }[];
  list: RowView[];
  flatLabel: string; unitLabel: string; unitShort: string;
  empty: boolean; emptyTitle: string; emptyText: string;
  kinds: { key: KindKey; label: string; on: boolean }[];
  states: { key: StateKey; label: string; tone: Tone; on: boolean; full: boolean }[];
}

export function applyFilter(items: PantryBatch[], st: FilterState, ctx: { productsById: Map<string, HouseholdProduct>; receiptAt?: string | null }): FilterView {
  const sort = SORTS.find((s) => s.key === st.sort) ?? SORTS[0]!;
  const active = CUTS.filter((c) => st.cuts.includes(c.key));
  const q = st.q.trim().toLowerCase();
  const pass = (it: PantryBatch) => active.every((c) => c.test(it)) && passQuery(it, q, ctx.productsById);
  const shown = sortItems(items.filter(pass), sort);
  const receiptOn = active.some((c) => c.key === 'receipt');
  const receiptSub = ctx.receiptAt ? `чек · ${shortDate(ctx.receiptAt)}` : 'з чека';
  const row = (it: PantryBatch): RowView => {
    const soon = it.days != null && it.days <= SOON_CUT_DAYS;
    const sub = it.no ? it.no
      : soon && sort.key !== 'fresh' ? (it.days! <= 0 ? 'сьогодні' : `ще ${it.days} дн`)
        : receiptOn && sort.key !== 'added' ? receiptSub : '';
    return {
      it, name: it.label, qty: it.value != null && it.unit ? formatQty(it.value, it.unit) : '', zone: ZONE_LABEL[it.zone],
      sub, subTone: it.no ? 'plum' : soon ? 'amber' : 'sage',
      fresh: freshness(it.days),
      val: sort.val ? sort.val(it) : '', valTone: sort.color ? sort.color(it) : 'fg',
    };
  };
  const grouped = sort.key === 'zone';
  const dirty = sort.key !== 'zone' || active.length > 0;
  // Крок Ф2: «N з M» лише коли список звужено (зріз або пошук); саме
  // сортування нічого не ховає — лічильник як без фільтра.
  const narrowed = active.length > 0 || !!q;
  const empty = dirty && shown.length === 0 && !q;
  const last = active[active.length - 1];
  return {
    sort, shown, dirty,
    // Етап 1.6: капс знято й тут — він був вписаний у самі рядки, не лише в CSS.
    meta: narrowed ? `${shown.length} з ${items.length}` : `${items.length} ${plural(items.length, ['позиція', 'позиції', 'позицій'])}`,
    grouped: grouped && !empty,
    // Ф2а: усередині групи порядок стабільний — новіші за added_at зверху,
    // однакова дата — за назвою; не за порядком з сервера (терміновість/updated_at),
    // щоб рядки не стрибали після правки.
    groups: grouped
      ? ZONE_ORDER.map((z) => ({ zone: z, label: ZONE_LABEL[z], items: shown.filter((it) => it.zone === z).sort(byAddedThenName) }))
        .filter((g) => g.items.length).map((g) => ({ zone: g.zone, label: g.label, count: g.items.length, items: g.items.map(row) }))
      : [],
    list: grouped ? [] : shown.map(row),
    flatLabel: sort.head ?? '', unitLabel: sort.unit ?? '', unitShort: sort.unitShort ?? sort.unit ?? '',
    empty,
    emptyTitle: empty ? (last ? EMPTY_TITLE[last.key] ?? 'Нічого' : 'Порожньо') : '',
    emptyText: empty ? (active.length > 1 ? 'Разом ці умови нічого не лишають.' : active.some((c) => c.group) ? 'Можна докупити.' : 'Добре.') : '',
    kinds: CUTS.filter((c) => c.group).map((c) => ({ key: c.key as KindKey, label: c.label, on: st.cuts.includes(c.key) })),
    states: CUTS.filter((c) => !c.group).map((c) => ({ key: c.key as StateKey, label: c.label, tone: c.tone, on: st.cuts.includes(c.key), full: stateFull(st, c.key as StateKey) })),
  };
}
