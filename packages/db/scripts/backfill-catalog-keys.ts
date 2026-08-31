// Каталог, крок 5: ретро-прохід по наявних продуктах дому — дорезолвити
// catalog_key і долити каталог-дефолти в ДІРКИ тегів (модельні/наявні теги
// не перезаписуються; бренд/варіант/назва не чіпаються ніколи).
// Ідемпотентний, без моделі.
//
// Запуск: cd packages/db && pnpm tsx scripts/backfill-catalog-keys.ts

import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { makePool } from '../pool.js';
import { PostgresRepo } from '../postgres-repo.js';
import { resolveLabelToKey } from '@kitchen/catalog';
import { BY_KEY } from '@kitchen/catalog/seed';
import { catalogGroupsToAllergens, isCatalogFasting, displayName, type ProductTags } from '@kitchen/domain';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });
const url = process.env.PG_URL;
if (!url) { console.error('PG_URL is required'); process.exit(1); }

const pool = makePool(url);
const repo = new PostgresRepo(pool);

const { rows: households } = await pool.query<{ id: string }>('SELECT id FROM household');
let keyed = 0, tagged = 0, skipped = 0;

for (const h of households) {
  for (const prod of await repo.listProducts(h.id)) {
    const patch: { catalog_key?: string; tags?: ProductTags } = {};
    let key = prod.catalog_key;
    if (!key) {
      key = resolveLabelToKey(prod.product) ?? resolveLabelToKey(displayName(prod));
      if (key) { patch.catalog_key = key; keyed++; }
    }
    const cat = key ? BY_KEY.get(key) : undefined;
    if (cat) {
      const tags: ProductTags = { ...prod.tags };
      let touched = false;
      if (tags.allergens === undefined) {
        const fromCat = catalogGroupsToAllergens(cat.allergen_groups);
        if (fromCat.length) { tags.allergens = fromCat; touched = true; }
      }
      if (tags.fasting === undefined && isCatalogFasting(cat)) { tags.fasting = true; touched = true; }
      if (touched) { patch.tags = tags; tagged++; }
    }
    if (Object.keys(patch).length) await repo.updateProduct(prod.id, patch);
    else skipped++;
  }
}
console.log(`keys resolved: ${keyed}, tags filled: ${tagged}, untouched: ${skipped}`);
await pool.end();
