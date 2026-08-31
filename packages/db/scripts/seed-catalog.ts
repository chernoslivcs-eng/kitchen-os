// Сід каталогу на dev Neon. Ідемпотентний upsert по key.
// Запуск: cd packages/db && pnpm tsx scripts/seed-catalog.ts

import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { makePool } from '../pool.js';
import { seedCatalog } from '../seed-catalog.js';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });
const url = process.env.PG_URL;
if (!url) { console.error('PG_URL is required'); process.exit(1); }
const pool = makePool(url);
const n = await seedCatalog(pool);
const { rows } = await pool.query('SELECT count(*) FROM catalog_ingredient');
console.log(`upserted: ${n}, у таблиці: ${rows[0].count}`);
await pool.end();
