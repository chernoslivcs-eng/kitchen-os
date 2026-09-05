// Раунд 4, крок 4: одноразовий бекфіл veto_index для наявних profile_text
// (перенесених міграцією 0023 — вона SQL і індекс будувати не вміє).
// Ідемпотентний: setVetoIndex замінює рядки поля цілком. Без моделі.
//
// Запуск: cd packages/db && PG_URL=… pnpm tsx scripts/backfill-veto-index.ts
// На проді — на кроці 9, разом із прапором.

import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { makePool } from '../pool.js';
import { PostgresRepo } from '../postgres-repo.js';
import { rebuildVetoIndex } from '@kitchen/domain';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });
const url = process.env.PG_URL;
if (!url) { console.error('PG_URL is required'); process.exit(1); }

const pool = makePool(url);
const repo = new PostgresRepo(pool);
const { rows } = await pool.query<{ user_id: string; key: 'no' | 'ban' }>(
  `SELECT user_id, key FROM profile_text WHERE key IN ('no', 'ban') AND status = 'filled'`,
);
let total = 0;
for (const r of rows) {
  const idx = await rebuildVetoIndex(repo, r.user_id, r.key);
  total += idx.length;
  console.log(`${r.user_id} ${r.key}: ${idx.map((x) => `${x.kind}:${x.ref ?? x.label}${x.allergy ? '!' : ''}`).join(', ') || '(порожньо)'}`);
}
console.log(`fields: ${rows.length}, rows: ${total}`);
await pool.end();
