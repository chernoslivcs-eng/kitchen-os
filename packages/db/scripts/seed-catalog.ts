// Каталог, крок 1: сід catalog_ingredient з @kitchen/catalog (2341 позиція).
// Ідемпотентний upsert по key — можна ганяти після кожного перезбирання
// seed.ts. Це знімає давній FK-біль: catalog_key нарешті можна писати.
//
// Запуск: cd packages/db && pnpm tsx scripts/seed-catalog.ts

import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { makePool } from '../pool.js';
import { CATALOG } from '@kitchen/catalog/seed';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });
const url = process.env.PG_URL;
if (!url) { console.error('PG_URL is required'); process.exit(1); }

const pool = makePool(url);
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
const { rows } = await pool.query('SELECT count(*) FROM catalog_ingredient');
console.log(`upserted: ${upserted}, у таблиці: ${rows[0].count}`);
await pool.end();
