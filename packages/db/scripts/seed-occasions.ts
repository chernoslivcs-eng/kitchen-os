// Сід довідника подій (сезони, свята, пости) — ідемпотентний upsert по id.
// Запуск: cd packages/db && pnpm tsx scripts/seed-occasions.ts
//
// Без цього кроку прод має порожній occasion_catalog: PostgresRepo читає
// довідник лише з таблиці, а BUILTIN_OCCASIONS бачить тільки чат. Ганяється
// кроком білду на Vercel разом із сідом каталогу — і саме тому правки рядків у
// коді (нові свята, інші дати Рамадану) доїжджають на прод із деплоєм.

import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { makePool } from '../pool.js';
import { seedOccasions } from '../seed-occasions.js';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });
const url = process.env.PG_URL;
if (!url) { console.error('PG_URL is required'); process.exit(1); }
const pool = makePool(url);
const n = await seedOccasions(pool);
const { rows } = await pool.query('SELECT count(*) FROM occasion_catalog WHERE published_at IS NOT NULL');
console.log(`upserted: ${n}, опубліковано в таблиці: ${rows[0].count}`);
await pool.end();
