// GENERIC-0915 (власник 15.09): ключ рішається раз при народженні продукту,
// тож наявні продукти без ключа новим довідником самі не підхопляться. Разовий
// бекфіл: для кожного household_product з catalog_key null — той самий шлях,
// що ensureProduct (resolveTripleKey: база трійки, потім displayName; вид бʼє gen_*), і
// запис ЛИШЕ де ключ знайшовся; теги — як там: allergens у дірку, fasting
// вирівняти за класом. Наявні ключі не чіпаються. Dry-run, поки не apply.
// 15.09 (#139): виняток — gen_*: перерішується, коли резолвер (із зоною
// найновішої партії як ctx) тепер дає видовий ключ; секція `refined`.
// #142: не-gen ключ із frozen-парою і партією у freezer → пара (`frozen`);
// назад (frozen → fresh) — ніколи: людина могла розморозити.
// Ядро спільне для скрипта стенда (packages/db/scripts) і адмін-ендпоінта.
import { resolveTripleKey, type ResolveCtx } from '@kitchen/catalog';
import { BY_KEY, CATALOG, type CatalogItem } from '@kitchen/catalog/seed';
import type { Repo } from './repo.js';
import { catalogGroupsToAllergens, isCatalogFasting, displayName, type ProductTags } from './product.js';

export interface BackfillGenericKeysLog {
  applied: boolean;
  /** Скільки продуктів було без ключа. */
  without_key: number;
  /** Кому ключ знайшовся (і записаний, коли applied). */
  filled: { household_id: string; product: string; key: string; name: string }[];
  /** Скільки лишились без ключа. */
  left: number;
  /** #139: продукти з gen_*, яким резолвер тепер дає видовий (не-gen) ключ. */
  refined: { household_id: string; product: string; from: string; to: string }[];
  /** #142: не-gen ключ із frozen-парою, найновіша партія у freezer → ключ пари. Назад — ніколи. */
  frozen: { household_id: string; product: string; from: string; to: string }[];
}

/** Теги як у ensureProduct: allergens у дірку, fasting вирівняти за класом. */
function retag(tags: ProductTags, cat: CatalogItem): ProductTags {
  const out: ProductTags = { ...tags };
  if (out.allergens === undefined) {
    const fromCat = catalogGroupsToAllergens(cat.allergen_groups);
    if (fromCat.length) out.allergens = fromCat;
  }
  out.fasting = isCatalogFasting(cat);
  return out;
}

export async function backfillGenericKeys(repo: Repo, opts: { apply: boolean }): Promise<BackfillGenericKeysLog> {
  const log: BackfillGenericKeysLog = { applied: opts.apply, without_key: 0, filled: [], left: 0, refined: [], frozen: [] };
  const households = await repo.listAdminHouseholds();
  for (const h of households) {
    // Зона найновішої партії продукту — контекст резолвера (#139, правило (б)).
    const zoneOf = new Map<string, { zone: ResolveCtx['zone']; at: string }>();
    for (const b of await repo.listBatches(h.id)) {
      if (!b.product_id) continue;
      const cur = zoneOf.get(b.product_id);
      if (!cur || b.added_at > cur.at) zoneOf.set(b.product_id, { zone: b.zone, at: b.added_at });
    }
    // Свіжий ключ → його заморожена пара (frozen_of вказує на цей ключ).
    const frozenPair = new Map<string, string>();
    for (const item of CATALOG) if (item.frozen_of) frozenPair.set(item.frozen_of, item.key);
    for (const prod of await repo.listProducts(h.id)) {
      if (prod.catalog_key && !prod.catalog_key.startsWith('gen_')) {
        const pair = frozenPair.get(prod.catalog_key);
        if (pair && zoneOf.get(prod.id)?.zone === 'freezer') {
          const cat = BY_KEY.get(pair)!;
          log.frozen.push({ household_id: h.id, product: prod.product, from: prod.catalog_key, to: pair });
          if (opts.apply) await repo.updateProduct(prod.id, { catalog_key: pair, tags: retag(prod.tags, cat) });
        }
        continue;
      }
      if (prod.catalog_key?.startsWith('gen_')) {
        // Перерішення лише вгору: gen_* → вид. Мовчання чи інший gen_* — без змін.
        const z = zoneOf.get(prod.id)?.zone;
        const ctx: ResolveCtx | undefined = z ? { zone: z } : undefined;
        const key = resolveTripleKey(prod.product, displayName(prod), 'anchored', undefined, ctx);
        const cat = key && !key.startsWith('gen_') ? BY_KEY.get(key) : undefined;
        if (!key || !cat) continue;
        log.refined.push({ household_id: h.id, product: prod.product, from: prod.catalog_key, to: key });
        if (opts.apply) await repo.updateProduct(prod.id, { catalog_key: key, tags: retag(prod.tags, cat) });
        continue;
      }
      if (prod.catalog_key) continue;
      log.without_key++;
      const key = resolveTripleKey(prod.product, displayName(prod));
      const cat = key ? BY_KEY.get(key) : undefined;
      if (!key || !cat) { log.left++; continue; }
      log.filled.push({ household_id: h.id, product: prod.product, key, name: cat.name });
      if (opts.apply) await repo.updateProduct(prod.id, { catalog_key: key, tags: retag(prod.tags, cat) });
    }
  }
  return log;
}

/** Текстовий лог для консолі/відповіді: «було N без ключа → M отримали (слово→ключ), K лишились». */
export function formatBackfillLog(log: BackfillGenericKeysLog): string {
  const pairs = log.filled.map((f) => `${f.product}→${f.key}`).join(', ');
  const ref = log.refined.map((r) => `${r.product}: ${r.from}→${r.to}`).join(', ');
  const frz = log.frozen.map((f) => `${f.product}: ${f.from}→${f.to}`).join(', ');
  return `було ${log.without_key} без ключа → ${log.filled.length} отримали${pairs ? ` (${pairs})` : ''}, ${log.left} лишились`
    + ` · уточнено gen_*: ${log.refined.length}${ref ? ` (${ref})` : ''}`
    + ` · заморожене за зоною: ${log.frozen.length}${frz ? ` (${frz})` : ''}${log.applied ? '' : ' · сухий прогін, нічого не записано'}`;
}
