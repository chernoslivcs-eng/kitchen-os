// Період — дві картки (серія і подія), спільні хелпери без React: підписи
// дат, «ще N днів», дубль заголовка в правилі, тон за джерелом. Чисті
// функції, щоб межі («сьогодні = останній день», «минуле не показувати»)
// перевірялись тестом, а не очима на стенді.

import type { NowItem, OccasionSet, PeriodItem, Tradition } from '../api';
import type { ToneKey } from './tone';

export const DAY = 86_400_000;

export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function parse(iso: string): Date {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Різниця в календарних днях між двома 'YYYY-MM-DD'. */
export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / DAY);
}

export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
  return forms[2];
}

/**
 * «ще N днів» від кінця періоду. Сьогодні — останній день; ще не почалось —
 * «за N днів»; минуле — нічого (null), картка минулого не рахує.
 */
export function leftLabel(from: string, to: string, today = todayIso()): string | null {
  if (to < today) return null;
  if (from > today) {
    const d = daysBetween(today, from);
    return d === 1 ? 'завтра' : `за ${d} ${plural(d, ['день', 'дні', 'днів'])}`;
  }
  const left = daysBetween(today, to);
  if (left === 0) return 'останній день';
  if (left === 1) return 'до завтра';
  return `ще ${left} ${plural(left, ['день', 'дні', 'днів'])}`;
}

const WEEKDAY = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/**
 * Слово часу для «Дім зараз» (етап 4, Components · «Дім зараз»). Від кінця,
 * і в одиницях, які людина рахує:
 *   · ≥ 14 днів — тижнями, округлено: «ще 5 тиж», не «ще 34 дні»;
 *   · своя подія в межах тижня — днем тижня: «до нд». Своє читається як
 *     зустріч, а зустріч мають на день, не на «ще 3 дн». Сезон із каталогу —
 *     не зустріч, лишається днями;
 *   · орієнтовне — «≈» перед словом. Ознака `approx` доти показувалась словом
 *     « · орієнтовно», і рядок не вміщався.
 * Форми «дн» і «тиж» — з бандла.
 */
export function nowWhen(
  it: { from: string; to: string; source: 'catalog' | 'user' | 'chat'; approx?: boolean },
  today = todayIso(),
): string | null {
  if (it.to < today) return null;
  const pre = it.approx ? '≈ ' : '';
  if (it.from > today) {
    const d = daysBetween(today, it.from);
    return d === 1 ? 'завтра' : `за ${d} дн`;
  }
  const left = daysBetween(today, it.to);
  if (left === 0) return 'останній день';
  if (left === 1) return 'до завтра';
  if (it.source !== 'catalog' && left <= 7) return `${pre}до ${WEEKDAY[new Date(it.to + 'T00:00:00').getDay()]}`;
  if (left >= 14) return `${pre}ще ${Math.round(left / 7)} тиж`;
  return `${pre}ще ${left} дн`;
}

/** «1 квіт», «23 лют» — без крапки, як у макеті. */
export function shortDate(iso: string): string {
  const d = parse(iso);
  const mon = d.toLocaleDateString('uk-UA', { month: 'short' }).replace('.', '');
  return `${d.getDate()} ${mon}`;
}

/** «вересень 2026 – травень 2027» для шапки серії. */
export function seriesRange(items: Pick<PeriodItem, 'from' | 'to'>[]): string {
  const dated = items.filter((i) => i.from && i.to);
  if (!dated.length) return '';
  const from = dated.map((i) => i.from).sort()[0]!;
  const to = dated.map((i) => i.to).sort().at(-1)!;
  const my = (iso: string) => {
    const d = parse(iso);
    return `${d.toLocaleDateString('uk-UA', { month: 'long' })} ${d.getFullYear()}`;
  };
  const a = my(from), b = my(to);
  return a === b ? a : `${a} – ${b}`;
}

/**
 * Правило рендеру заголовка й правила (П2, з П1а): «білкова — більше білка…»
 * дублює «білкова». Якщо правило починається з заголовка — показуємо лише
 * правило; правила нема — лише заголовок.
 */
export function dedupeTitle(title: string, rule?: string | null): { title: string | null; rule: string | null } {
  const t = title.trim();
  const r = (rule ?? '').trim();
  if (!r) return { title: t || null, rule: null };
  if (t && r.toLowerCase().startsWith(t.toLowerCase())) return { title: null, rule: r };
  return { title: t || null, rule: r };
}

export const TRADITION_LABEL: Record<Tradition, string> = {
  orthodox: 'православні', catholic: 'католицькі', islamic: 'ісламські', jewish: 'юдейські', secular: 'світські',
};
export const TRADITION_SETS: Tradition[] = ['orthodox', 'catholic', 'jewish', 'islamic', 'secular'];

export function seriesTitle(set: OccasionSet): string {
  return set === 'seasons' ? 'сезони' : `${TRADITION_LABEL[set]} свята`;
}

export function seriesKicker(set: OccasionSet): { text: string; tone: 'amber' | 'plum' } {
  return set === 'seasons' ? { text: 'сезони', tone: 'amber' } : { text: 'свята · з традиції', tone: 'plum' };
}

export const SERIES_TEXT: Record<'seasons' | 'tradition' | 'unsubscribe', string> = {
  seasons: 'Увімкнені від початку — нагадую, коли що в піку, і підказую, що з цим готувати. Зніми, що не твоє.',
  tradition: 'Дати — з календаря на кілька років уперед. Зніми зайве і запиши; посунути окреме свято можна буде вже в календарі.',
  unsubscribe: 'Зніму з календаря і з підказок. Повернути можна внизу календаря.',
};

export const STRICT_HINT = 'не пропоную сам; попросиш прямо — попереджу і зроблю';
// Підказка мʼякого — з кадрів «Календар · 1440» aside і Prototype (A2 показує лише суворе).
export const SOFT_HINT = 'враховую в пропозиціях, але не забороняю';

export type OwnKind = 'diet' | 'holiday' | 'custom';
export const OWN_KIND_LABEL: Record<OwnKind, string> = { diet: 'дієта', holiday: 'свято · своє', custom: 'подія дому' };

/** Рід картки події для свого запису: dієта, своє свято (custom без порцій), подія дому. */
export function ownKindOf(kind: string | undefined, servings?: number | null): OwnKind {
  if (kind === 'diet') return 'diet';
  if (kind === 'custom' && servings == null) return 'holiday';
  return 'custom';
}

/** Тон за джерелом: сезон — амбер, свято з традиції — слива, своє — шавлія; суворе завжди слива. */
export function toneOfNow(it: Pick<NowItem, 'kind' | 'strict' | 'source'>): ToneKey {
  if (it.strict) return 'restrict';
  if (it.source !== 'catalog') return 'own';
  if (it.kind === 'tradition') return 'tradition';
  return 'season';
}

/**
 * Порожній стан «Дім зараз» (Components · «Порожні стани · різні слова»).
 * Три порожнечі — три різні речі, і всі три реальні просто зараз:
 *   'pantry-empty' — позицій нуль: нема з чим працювати;
 *   'calm'         — комора є і нічого не горить: рідкісний спокій;
 *   'no-events'    — подій немає, а комора не спокійна або невідома.
 * Доти всі три звучали як мовчання — блок просто не малювався.
 */
export type NowEmpty = 'pantry-empty' | 'calm' | 'no-events';

export function nowEmptyKind(facts: { count: number; soon: number } | null): NowEmpty {
  if (facts?.count === 0) return 'pantry-empty';
  if (facts && facts.soon === 0) return 'calm';
  return 'no-events';
}

export function nowEmptyText(facts: { count: number; soon: number } | null): string {
  switch (nowEmptyKind(facts)) {
    case 'pantry-empty': return 'Комора порожня — розкажи, що є вдома.';
    case 'calm': return `Нічого не горить. ${facts!.count} ${plural(facts!.count, ['позиція', 'позиції', 'позицій'])} у порядку.`;
    default: return 'Зараз нічого не триває. Свята можна підключити в календарі.';
  }
}
