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

// Етап 2a (рішення Р2): пороги більше не живуть тут. Вони переїхали в
// `@kitchen/domain/shelf-thresholds` — файл СТОРІНКИ не місце для контракту,
// і саме тому число 3 встигло розмножитись: Feed тримав власну копію
// літералом, а промт — сьому добу третім числом.
//
// Реекспорт лишається, щоб не переписувати місця вжитку заради шляху імпорту.
import {
  SOON_CUT_DAYS, freshness, isSoon, timeWord, hasScale, type Freshness,
} from '@kitchen/domain/shelf-thresholds';
export {
  SOON_CUT_DAYS, FRESH_SOON_DAYS, FRESH_CHECK_DAYS,
  freshness, isSoon, noTermReason, timeWord, hasScale,
  FRESHNESS_LABEL, NO_TERM_LABEL,
  type Freshness, type NoTermReason,
} from '@kitchen/domain/shelf-thresholds';

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
/**
 * Знак зони — з четвертої сімʼї словника (етап 1.5). Зони мають власні знаки,
 * а не позичені: раніше «Свіже» брало `leaf` у «Зелень», а «Спеції» — `flame`
 * у «Горить», і чотири з шести конфліктували.
 */
export const ZONE_ICON: Record<PantryBatch['zone'], `zone.${string}`> = {
  fresh: 'zone.fresh', fridge: 'zone.fridge', freezer: 'zone.freezer',
  dry: 'zone.dry', spices: 'zone.spices', drinks: 'zone.drinks',
};

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
  // Зріз кличе ту саму `isSoon`, що й решта, — і додає `hasScale`. Без
  // каталожного ключа партія у зріз НЕ потрапляє: її число — здогадка таблиці
  // зон, і рядок його не показує. Фільтр, який довіряє числу, що рядок
  // відмовляється показати, обіцяє знання, якого немає.
  // Прострочене у зріз потрапляє: `isSoon(-9)` це `true` навмисно.
  { key: 'soon', label: 'скоро зіпсується', tone: 'amber', test: (it) => isSoon(it.days) && hasScale(it.catalog_key) },
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

/**
 * Рядок комори — ТРИ осі в трьох окремих каналах (етап 2a, рішення Р10).
 *
 * Досі всі три ділили один канал `sub`: одна стрічка показувала або безпеку,
 * або час, або походження — що перше збіглось. Тобто «не їм» ховало строк, а
 * строк ховав чек. Слоти за tokens-v3 · «Слоти рядка комори»:
 *
 *   [шкала] [назва · паспортна] [безпека] [походження] [час] [кількість]
 *
 * Крок Ф2 зводив рядок до однієї осі не тому, що осей мало, а тому що мітки
 * стояли НА СПІЛЬНІЙ осі й змагалися. Окремі канали цього не створюють.
 */
export interface RowView {
  it: PantryBatch;
  /** «Наше імʼя» — те, як цю річ називає людина. */
  name: string;
  /** Другий ярус: паспортна назва постачальника. Порожня, коли трійка без брендa. */
  passport: string;
  qty: string; zone: string;
  fresh: Freshness;
  /** Без каталожного ключа шкали немає — вона обіцяла б точність, якої нема. */
  scale: boolean;
  /** Слово часу — чотири написання з домену. */
  time: string; timeTone: Tone;
  /** Свій слот: обмеження людини. Не змагається з часом. */
  safety: 'не їм' | 'не можна' | null;
  /** Свій слот: звідки партія. Іконка 12, без тексту. */
  origin: OriginKind | null;
  val: string; valTone: Tone;
}

/**
 * Походження партії. Три, бо стільки віддає API (`origin.kind`) — а не чотири,
 * як у макеті: «зі списку» рішенням Р6 знято, покупка зі списку все одно
 * приходить чеком або рукою.
 */
export type OriginKind = 'receipt' | 'manual' | 'chat';

export const ORIGIN_ICON: Record<OriginKind, 'sys.receipt' | 'live.byHand' | 'sys.chat'> = {
  receipt: 'sys.receipt', manual: 'live.byHand', chat: 'sys.chat',
};
export const ORIGIN_LABEL: Record<OriginKind, string> = {
  receipt: 'з чека', manual: 'рукою', chat: 'з розмови',
};

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

/**
 * Чому зріз нічого не лишив. Окремим випадком — позиції без каталожного ключа:
 * вони невидимі для фільтрів роду, бо роду в них немає.
 */
function emptyReason(active: CutDef[], all: PantryBatch[]): string {
  const noKey = all.filter((it) => !it.catalog_key).length;
  const byKind = active.some((c) => c.group);
  if (byKind && noKey > 0) {
    const tail = noKey === all.length
      ? 'У жодної позиції в коморі немає категорії, тому роди їх не бачать.'
      : `${noKey} ${plural(noKey, ['позиція', 'позиції', 'позицій'])} без категорії — роди їх не бачать.`;
    return active.length > 1 ? `Разом ці умови нічого не лишають. ${tail}` : tail;
  }
  if (active.length > 1) return 'Разом ці умови нічого не лишають.';
  return byKind ? 'Можна докупити.' : 'Добре.';
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
    const st = freshness(it.days);
    // Другий ярус — бренд і різновид із трійки продукту. Назва не може бути
    // найгучнішим елементом рядка, якщо половина її — код калібру (PLAN §2).
    const prod = it.product_id ? ctx.productsById.get(it.product_id) : undefined;
    const passport = [prod?.brand, prod?.variant].filter(Boolean).join(' · ');
    return {
      it, name: it.label, passport,
      qty: it.value != null && it.unit ? formatQty(it.value, it.unit) : '',
      zone: ZONE_LABEL[it.zone],
      fresh: st,
      scale: hasScale(it.catalog_key),
      // Р4: «до 14 вер» — тільки коли дату поставила ЛЮДИНА. Розрахунок на
      // відкритті теж пише `expires_at`, але він не точна дата, а оцінка, і
      // подавати його як «до …» означало б видавати здогадку за слово людини.
      time: timeWord(it.days, it.catalog_key, it.expires_source === 'manual' ? shortDate(it.expires_at) : null),
      // Прострочене — danger; «добігає» і «перевірити» — бурштин; решта тихо.
      // Без шкали тон завжди тихий: якщо ми не довіряємо числу настільки, щоб
      // показати строк, то й фарбувати його тривогою не маємо права. Інакше
      // «без категорії» світилося б червоним на позиції, про яку ми нічого не
      // знаємо — саме це й вилізло на живому засіві.
      timeTone: !hasScale(it.catalog_key) ? 'dim'
        : st === 'overdue' ? 'danger' : st === 'good' ? 'dim' : 'amber',
      safety: it.no ?? null,
      // На партії два поля про походження: новіше `origin.kind` і старіше
      // `receipt` булевим. Беремо перше, друге лишаємо запасним — інакше
      // партії до бекфілу втратили б слот, який щойно отримали.
      origin: it.origin?.kind ?? (it.receipt ? 'receipt' : null),
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
    // PLAN §2, останній пункт: фільтри РОДІВ не бачать позицій без каталогу —
    // рід беруть із `it.cat`, а без ключа він null. Досі це було мовчазне
    // зникнення: людина ставила «мʼясне», отримувала «Порожньо» і не мала
    // звідки знати, що частина комори просто не має роду. Тепер порожній стан
    // це називає, і числом.
    emptyText: empty ? emptyReason(active, items) : '',
    kinds: CUTS.filter((c) => c.group).map((c) => ({ key: c.key as KindKey, label: c.label, on: st.cuts.includes(c.key) })),
    states: CUTS.filter((c) => !c.group).map((c) => ({ key: c.key as StateKey, label: c.label, tone: c.tone, on: st.cuts.includes(c.key), full: stateFull(st, c.key as StateKey) })),
  };
}
