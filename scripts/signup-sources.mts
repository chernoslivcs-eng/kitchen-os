#!/usr/bin/env npx tsx
// Звіт «джерела реєстрації»: який канал (LinkedIn, Instagram, реклама, експерт)
// приводить людей і скільки приведених домів ожило — партія в коморі,
// готування, активна підписка. Сам запит — docs/signup-sources.sql, тут лише
// запуск і друк трьох таблиць.
//
//   npx tsx scripts/signup-sources.mts        # з головної теки: PG_URL береться з .env
//
// Тільки читання. Скрипт навмисно НЕ імпортує services/api/src/server.ts (той
// сам накочує міграції в базу з .env) і ганяє запит у транзакції READ ONLY —
// зіпсувати ним у базі нічого не можна.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { makePool } from '../packages/db/pool.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(resolve(ROOT, '.env')); } catch { /* .env немає — PG_URL з оточення */ }

const url = process.env.PG_URL;
if (!url) {
  console.error('PG_URL не задано: запусти з теки, де лежить .env, або передай PG_URL=… перед командою.');
  process.exit(1);
}

const TITLES = [
  'Реєстрації по джерелах (нові доми)',
  'У розрізі кампаній і способу входу',
  'Запрошені в чужий дім (у реєстрації не входять)',
];

type Result = { rows: Record<string, unknown>[] };
// count(*) pg віддає рядком (bigint) — для таблиці зручніше число.
const tidy = (rows: Record<string, unknown>[]) =>
  rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^\d+$/.test(v) && !k.startsWith('utm_') && k !== 'ref' && k !== 'source' ? Number(v) : v ?? ''])));

const sql = readFileSync(resolve(ROOT, 'docs/signup-sources.sql'), 'utf-8');
const pool = makePool(url);
const client = await pool.connect();
let failed = false;
try {
  await client.query('BEGIN TRANSACTION READ ONLY');
  // Кілька запитів одним викликом — pg повертає масив результатів.
  const out = (await client.query(sql)) as unknown as Result | Result[];
  const results = Array.isArray(out) ? out : [out];
  results.forEach((res, i) => {
    console.log(`\n${TITLES[i] ?? `Запит ${i + 1}`}`);
    if (res.rows.length) console.table(tidy(res.rows));
    else console.log('  (порожньо)');
  });
} catch (err) {
  failed = true;
  const msg = (err as Error).message;
  if (/signup_source.*does not exist/.test(msg)) {
    console.error('Таблиці signup_source у цій базі ще немає: міграцію 0052 накочує деплой. Спершу деплой — потім звіт.');
  } else {
    console.error(`Запит не виконався: ${msg}`);
  }
} finally {
  await client.query('ROLLBACK').catch(() => {});
  client.release();
  await pool.end();
}
if (failed) process.exit(1);
