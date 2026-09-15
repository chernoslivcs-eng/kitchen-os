// GENERIC-0915 (власник 15.09): ключ рішається раз при народженні продукту,
// тож наявні продукти без ключа новим довідником самі не підхопляться. Разовий
// бекфіл: для кожного household_product з catalog_key null — той самий шлях,
// що ensureProduct (resolveLabelToKey по product, потім по displayName), і
// запис ЛИШЕ де ключ знайшовся; теги — як там: allergens у дірку, fasting
// вирівняти за класом. Наявні ключі не чіпаються. Dry-run, поки не apply.
// Ядро спільне для скрипта стенда (packages/db/scripts) і адмін-ендпоінта.
import { resolveLabelToKey } from '@kitchen/catalog';
import { BY_KEY } from '@kitchen/catalog/seed';
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
}

export async function backfillGenericKeys(repo: Repo, opts: { apply: boolean }): Promise<BackfillGenericKeysLog> {
  const log: BackfillGenericKeysLog = { applied: opts.apply, without_key: 0, filled: [], left: 0 };
  const households = await repo.listAdminHouseholds();
  for (const h of households) {
    for (const prod of await repo.listProducts(h.id)) {
      if (prod.catalog_key) continue;
      log.without_key++;
      const key = resolveLabelToKey(prod.product) ?? resolveLabelToKey(displayName(prod));
      const cat = key ? BY_KEY.get(key) : undefined;
      if (!key || !cat) { log.left++; continue; }
      log.filled.push({ household_id: h.id, product: prod.product, key, name: cat.name });
      if (!opts.apply) continue;
      const tags: ProductTags = { ...prod.tags };
      if (tags.allergens === undefined) {
        const fromCat = catalogGroupsToAllergens(cat.allergen_groups);
        if (fromCat.length) tags.allergens = fromCat;
      }
      tags.fasting = isCatalogFasting(cat);
      await repo.updateProduct(prod.id, { catalog_key: key, tags });
    }
  }
  return log;
}

/** Текстовий лог для консолі/відповіді: «було N без ключа → M отримали (слово→ключ), K лишились». */
export function formatBackfillLog(log: BackfillGenericKeysLog): string {
  const pairs = log.filled.map((f) => `${f.product}→${f.key}`).join(', ');
  return `було ${log.without_key} без ключа → ${log.filled.length} отримали${pairs ? ` (${pairs})` : ''}, ${log.left} лишились${log.applied ? '' : ' · сухий прогін, нічого не записано'}`;
}
