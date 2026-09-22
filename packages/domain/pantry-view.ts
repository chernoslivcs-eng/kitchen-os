// Раунд 5, крок Ф1: поля позиції комори для фільтра на клієнті
// (design/PANTRY-FILTER-v2.dc.html). Усе рахується з того, що вже є: каталог,
// індекс вето, термін партії, останній чек. Нічого не пишеться.

import { BY_KEY } from '@kitchen/catalog/seed';
import type { PantryBatch } from './types.js';
import type { HouseholdProduct } from './product.js';
import type { VetoRow } from './profile-text.js';
import { matchVeto, type VetoScope } from './veto.js';
import { kcalOf, isEstimate, carbsForDisplay } from './nutrition.js';
import { shelfSealedDays, openDaysFor } from './shelf-life.js';

export type PantryNo = 'не їм' | 'не можна' | null;

/**
 * Рядки індексу, що збігаються з партією: за назвою партії і за назвою позиції
 * каталогу її продукту («стейк рібай» → яловичина → мʼясо). Те саме, що ставить
 * ⚠ у [КОМОРА] промпту — одне джерело для обох.
 */
export function pantryVetoRows(b: Pick<PantryBatch, 'label'>, catalogKey: string | null | undefined, index: VetoRow[], scope?: VetoScope): VetoRow[] {
  if (!index.length) return [];
  return matchVeto(b.label, index, scope)
    .concat(catalogKey ? matchVeto(BY_KEY.get(catalogKey)?.name ?? '', index, scope) : [])
    .filter((r, i, arr) => arr.findIndex((x) => x.kind === r.kind && x.ref === r.ref) === i);
}

/** «не можна» — хоч один рядок з allergy (ban); «не їм» — решта збігів. */
export function vetoMarkOf(rows: VetoRow[]): PantryNo {
  if (!rows.length) return null;
  return rows.some((r) => r.allergy) ? 'не можна' : 'не їм';
}

// Верхня категорія каталогу — одна з ~20 груп, за токенами categories позиції.
// Порядок правил і є пріоритет: перший збіг виграє. Консерви лишаються
// консервами (тунець у бляшанці — не «рибне»), заморожене — за родом їжі.
const GROUP_RULES: [string, RegExp][] = [
  ['побутове', /^(нехарчове|корм для тварин|засоби гігієни|побутова хімія|гігієна тварин)$/],
  ['дитяче', /^дитяче харчування$/],
  ['алкоголь', /^(алкоголь|міцний алкоголь|вино|пиво)$/],
  ['кава й чай', /^(кава|чай|чорний чай|зелений чай|кава зернова|трав.?яний чай)$/],
  ['напої', /^(напої|рослинне молоко|сік|вода|газована вода|лимонад|енергетики)$/],
  ['консерви', /^(консерви|мариноване|рибні консерви|мʼясні консерви)$/],
  ['ковбаси', /^(ковбаса|ковбаси|сосиски|сардельки|шинка|бекон|салямі|паштет|сирокопчене|варено-копчене|напівкопчене|балик|делікатеси|мʼясні делікатеси)$/],
  ['риба', /^(риба|морська риба|річкова риба|морепродукти|молюски|ракоподібні|ікра|біла риба|червона риба)$/],
  ['мʼясо', /^(мʼясо|птиця|субпродукти|свинина|яловичина|курка|індичка|баранина|телятина|кролик)$/],
  ['яйця', /^яйця$/],
  ['сири', /^(сир|сири|твердий сир|мʼякий сир|свіжий сир|плавлений сир|розсольний сир|блакитний сир|сир кисломолочний)$/],
  ['молочне', /^(молочне|кисломолочне|молоко|молоко коровʼяче|масло вершкове|вершки|йогурт|кефір|сметана)$/],
  ['зелень і бобові', /^(бобові|зелень|трави|сушені трави|свіжа зелень)$/],
  ['овочі', /^(овочі|гриби|пасльонові|коренеплоди|капустяні|гарбузові|цибулеві)$/],
  ['фрукти', /^(фрукти|ягоди|сухофрукти|цитрусові|кісточкові)$/],
  ['горіхи й олії', /^(горіхи|насіння|жири|олія|горіхова паста)$/],
  ['спеції', /^(спеції|приправа|харчові добавки|мінеральне|суміш спецій|сіль)$/],
  ['соуси', /^(соус|гострий соус|соуси|кетчуп|майонез)$/],
  ['солодке', /^(солодке|какао|шоколад|цукерки|печиво|десерт)$/],
  ['крупи й хліб', /^(зернові|хліб|випічка|борошняне|крупа|паста|пластівці|борошно)$/],
  ['снеки', /^(снеки|чіпси|сухарики)$/],
  ['готове', /^(готові страви|кулінарія|готове|напівфабрикат)$/],
  ['заморожене', /^заморожене$/],
];
const GROUP_PRIORITY = GROUP_RULES.map(([g]) => g);

export function topCategory(categories: readonly string[]): string | null {
  const toks = categories.map((c) => c.toLowerCase().replace(/[ʼ'’]/g, 'ʼ').trim());
  let best: string | null = null;
  for (const t of toks) {
    for (const [group, re] of GROUP_RULES) {
      if (re.test(t)) {
        if (best === null || GROUP_PRIORITY.indexOf(group) < GROUP_PRIORITY.indexOf(best)) best = group;
        break;
      }
    }
  }
  return best;
}

// Дефолтів зон (ZONE_SHELF_DAYS) більше нема — v2 (21.09): порожня клітинка
// таблиці означає «зона не для цього продукту», числа не показуємо. Саме
// дефолти давали «томатна паста → 540» і «олія відкрита → 363» в аудиті.

/**
 * Строк партії. Рахується, а не зберігається (Р2): у БД його ніхто не пише.
 *
 * Порядок джерел:
 *   1. `expires_at` партії — ручна дата з картки або дата, поставлена при
 *      відкритті. Єдиний писач колонки, тож вона означає рівно «людина
 *      сказала» і бʼє розрахунок завжди — і коротша, і довша.
 *   2. `added_at` + клітинка таблиці строків (shelf-life.ts) для категорії, стану і зони;
 *      порожня клітинка — строку нема.
 *
 * Обчислення замість колонки дає три речі: зміна зони одразу дає новий строк
 * без правки даних, зміна таблиці переоцінює всю комору без міграції, а
 * бекфіл на 246 наявних партій не потрібен узагалі.
 */
export function effectiveExpiry(
  b: Pick<PantryBatch, 'expires_at' | 'added_at' | 'zone'> & Partial<Pick<PantryBatch, 'state' | 'opened_at' | 'best_before_opened_days'>>,
  catalogKey: string | null = null,
  _nowMs = Date.now(),
): string | null {
  if (b.expires_at) return b.expires_at;
  // v2 (21.09): одна таблиця за категорією × стан × група зони. `null` — не
  // псується; `undefined` — числа нема (каталог мовчить, зона не для цього
  // продукту, арбітр проти хибного ключа) — і тоді строку НЕМА, без дефолту зони.
  const fromCatalog = shelfSealedDays(catalogKey, b.zone);
  const sealed = fromCatalog == null ? null
    : new Date(new Date(b.added_at).getTime() + fromCatalog * 86_400_000).toISOString();
  // Відкрита партія без записаного строку — годинник «після відкриття»: тег
  // моделі, а без нього таблиця (колонка «відкрите» для цієї зони). Відлік від
  // opened_at; партія, створена одразу відкритою, — від дня додавання.
  if (b.state === 'opened') {
    const openDays = openDaysFor({ best_before_opened_days: b.best_before_opened_days ?? null, catalog_key: catalogKey, zone: b.zone });
    return expiryOnOpen(sealed, openDays, new Date(b.opened_at ?? b.added_at).getTime());
  }
  return sealed;
}

/** Днів до кінця свіжості — та сама арифметика, що в «Зараз» у стрічці. */
export function daysLeft(expires_at: string | null, nowMs = Date.now()): number | null {
  if (!expires_at) return null;
  return Math.round((new Date(expires_at).getTime() - nowMs) / 86_400_000);
}

/**
 * Строк партії після відкриття: МЕНШЕ з двох — того, що вже стояло, і того, що
 * дає `best_before_opened_days` від сьогодні.
 *
 * Відкриття може тільки скоротити життя продукту, ніколи не подовжити. Раніше
 * тут був безумовний перезапис, і пачка, якій лишався день, від самого факту
 * відкриття починала жити стільки, скільки живе щойно відкрита. Виміряно на
 * проді 09.09.2026: із 37 партій із `best_before_opened_days` відкриття
 * подовжило б строк 14 (гірчиця — з 14 днів на 60; спаржа з нульовим залишком
 * «ожила» б на три дні).
 */
export function expiryOnOpen(
  prev: string | null,
  openDays: number | null,
  nowMs = Date.now(),
): string | null {
  if (!openDays) return prev;
  const fromOpen = nowMs + openDays * 86_400_000;
  if (!prev) return new Date(fromOpen).toISOString();
  return Math.min(new Date(prev).getTime(), fromOpen) === fromOpen
    ? new Date(fromOpen).toISOString()
    : prev;
}

export interface PantryItemView {
  /** Ключ каталогу, за яким порахували cat/kcal/days: партії або продукту. */
  catalog_key: string | null;
  cat: string | null;
  kcal: number | null; fat: number | null; prot: number | null; carb: number | null;
  /** null — БЖВ немає; true — оцінка; false — джерело USDA/CIQUAL. */
  est: boolean | null;
  days: number | null;
  receipt: boolean;
  no: PantryNo;
  added: number;
  /** Вага штуки з каталогу (г), якщо є — для «на позицію» при одиниці шт. */
  unit_weight: number | null;
}

export function pantryItemView(
  b: PantryBatch,
  prod: HouseholdProduct | undefined,
  vetoIndex: VetoRow[],
  receiptBatchIds: ReadonlySet<string>,
  nowMs = Date.now(),
  // Крок Ш3: спільний кеш footprint на один прохід комори. Не передали —
  // працює як раніше, просто без економії.
  scope?: VetoScope,
): PantryItemView {
  const key = b.catalog_key ?? prod?.catalog_key ?? null;
  const item = key ? BY_KEY.get(key) : undefined;
  const n = item?.nutrition;
  return {
    // 15.09: ключ, за яким усе порахували, — у відповідь. Партія свого ключа
    // не має ніколи (apply пише null), ключ живе на продукті; веб читає
    // batch.catalog_key (hasScale, «без категорії», тон строку, зріз
    // «спливає», «Дім зараз») — і з 11.09 бачив null на ВСІХ позиціях, хоч
    // cat/kcal/days тут же були порахувані. Прод власника: 0 із 129 із ключем.
    catalog_key: key,
    cat: item ? topCategory(item.categories) : null,
    kcal: n ? kcalOf(n) : null,
    fat: n ? n.fat : null,
    prot: n ? n.protein : null,
    carb: n ? carbsForDisplay(n) : null,
    est: n ? isEstimate(n) : null,
    // Б1: строк рахується, а не читається з колонки. Ручна дата всередині
    // effectiveExpiry лишається сильнішою за таблицю зон.
    days: daysLeft(effectiveExpiry(b, key, nowMs), nowMs),
    receipt: receiptBatchIds.has(b.id),
    no: vetoMarkOf(pantryVetoRows(b, prod?.catalog_key ?? null, vetoIndex, scope)),
    added: Math.max(0, Math.floor((nowMs - new Date(b.added_at).getTime()) / 86_400_000)),
    unit_weight: item?.unit_weight ?? null,
  };
}
