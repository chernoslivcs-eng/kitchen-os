// Черга Д (№2), перехідний захист: бекфіл «продуктів дому» для партій,
// створених до household_product. Розкладати label на трійку без моделі не
// беремось — product = label as-is, brand/variant порожні; теги мінімальні
// (shelf_open_days з best_before_opened_days, якщо партія його мала).
// Ідемпотентний: партії з product_id пропускаються, трійки реюзаються.
//
// Запуск: cd packages/db && pnpm tsx scripts/backfill-products.ts

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { makePool } from '../pool.js';
import { PostgresRepo } from '../postgres-repo.js';
import { normalizeTriple, type ProductTags } from '@kitchen/domain';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });
const url = process.env.PG_URL;
if (!url) { console.error('PG_URL is required'); process.exit(1); }

const pool = makePool(url);
const repo = new PostgresRepo(pool);

const { rows: households } = await pool.query<{ id: string }>('SELECT id FROM household');
let created = 0, linked = 0, skipped = 0;

for (const h of households) {
  const batches = await repo.listBatches(h.id);
  for (const b of batches) {
    if (b.product_id) { skipped++; continue; }
    const triple = normalizeTriple({ product: b.label });
    if (!triple.product) { skipped++; continue; }
    let prod = await repo.findProductByTriple(h.id, triple);
    if (!prod) {
      const tags: ProductTags = {};
      if (b.best_before_opened_days != null) tags.shelf_open_days = b.best_before_opened_days;
      prod = {
        id: randomUUID(),
        household_id: h.id,
        ...triple,
        unit: b.unit === 'pack' ? null : b.unit,
        pack_size: null,
        tags,
        catalog_key: b.catalog_key,
        created_at: new Date().toISOString(),
      };
      await repo.insertProduct(prod);
      created++;
    }
    await repo.updateBatch(b.id, { product_id: prod.id });
    linked++;
  }
}

console.log(`products created: ${created}, batches linked: ${linked}, skipped: ${skipped}`);
await pool.end();
