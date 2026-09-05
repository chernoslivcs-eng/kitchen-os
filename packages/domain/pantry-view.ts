// Раунд 5, крок Ф1: поля позиції комори для фільтра на клієнті
// (design/PANTRY-FILTER-v2.dc.html). Усе рахується з того, що вже є: каталог,
// індекс вето, термін партії, останній чек. Нічого не пишеться.

import { BY_KEY } from '@kitchen/catalog/seed';
import type { PantryBatch } from './types.js';
import type { HouseholdProduct } from './product.js';
import type { VetoRow } from './profile-text.js';
import { matchVeto } from './veto.js';
import { kcalOf, isEstimate } from './nutrition.js';

export type PantryNo = 'не їм' | 'не можна' | null;

/**
 * Рядки індексу, що збігаються з партією: за назвою партії і за назвою позиції
 * каталогу її продукту («стейк рібай» → яловичина → мʼясо). Те саме, що ставить
 * ⚠ у [КОМОРА] промпту — одне джерело для обох.
 */
export function pantryVetoRows(b: Pick<PantryBatch, 'label'>, catalogKey: string | null | undefined, index: VetoRow[]): VetoRow[] {
  if (!index.length) return [];
  return matchVeto(b.label, index)
    .concat(catalogKey ? matchVeto(BY_KEY.get(catalogKey)?.name ?? '', index) : [])
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

/** Днів до кінця свіжості — та сама арифметика, що в «Зараз» у стрічці. */
export function daysLeft(expires_at: string | null, nowMs = Date.now()): number | null {
  if (!expires_at) return null;
  return Math.round((new Date(expires_at).getTime() - nowMs) / 86_400_000);
}

export interface PantryItemView {
  cat: string | null;
  kcal: number | null; fat: number | null; prot: number | null; carb: number | null;
  /** null — БЖВ немає; true — оцінка; false — джерело USDA/CIQUAL. */
  est: boolean | null;
  days: number | null;
  receipt: boolean;
  no: PantryNo;
  added: number;
}

export function pantryItemView(
  b: PantryBatch,
  prod: HouseholdProduct | undefined,
  vetoIndex: VetoRow[],
  receiptBatchIds: ReadonlySet<string>,
  nowMs = Date.now(),
): PantryItemView {
  const key = b.catalog_key ?? prod?.catalog_key ?? null;
  const item = key ? BY_KEY.get(key) : undefined;
  const n = item?.nutrition;
  return {
    cat: item ? topCategory(item.categories) : null,
    kcal: n ? kcalOf(n) : null,
    fat: n ? n.fat : null,
    prot: n ? n.protein : null,
    carb: n ? n.carbs : null,
    est: n ? isEstimate(n) : null,
    days: daysLeft(b.expires_at, nowMs),
    receipt: receiptBatchIds.has(b.id),
    no: vetoMarkOf(pantryVetoRows(b, prod?.catalog_key ?? null, vetoIndex)),
    added: Math.max(0, Math.floor((nowMs - new Date(b.added_at).getTime()) / 86_400_000)),
  };
}
