// Сід каталогу як функція: викликається CLI-скриптом (dev Neon) і
// PG-контрактними тестами (свіжий контейнер/CI-сервіс потребує каталог
// під FK household_product.catalog_key).

import type { Pool } from './pool.js';
import { CATALOG } from '@kitchen/catalog/seed';

export async function seedCatalog(pool: Pool): Promise<number> {
  let upserted = 0;
  for (const item of CATALOG) {
    await pool.query(
      `INSERT INTO catalog_ingredient (key, name, aliases, categories, allergen_groups, zone_default, unit_weight, density, nutrition)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (key) DO UPDATE SET
         name = EXCLUDED.name, aliases = EXCLUDED.aliases, categories = EXCLUDED.categories,
         allergen_groups = EXCLUDED.allergen_groups, zone_default = EXCLUDED.zone_default,
         unit_weight = EXCLUDED.unit_weight, density = EXCLUDED.density, nutrition = EXCLUDED.nutrition`,
      [
        item.key, item.name, item.aliases, item.categories, item.allergen_groups,
        item.zone_default, item.unit_weight ?? null, item.density ?? null,
        item.nutrition ? JSON.stringify(item.nutrition) : null,
      ],
    );
    upserted++;
  }
  return upserted;
}
