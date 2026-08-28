// Простий раннер міграцій. Читає migrations/*.sql у алфавітному порядку,
// застосовує ті, яких нема в schema_migrations. Транзакція на кожну.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { makePool, type Pool } from './pool.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = resolve(HERE, '../../migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function migrate(pool: Pool, dir: string = DEFAULT_DIR): Promise<MigrationResult> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = readdirSync(dir).filter((f: string) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name));

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    if (done.has(file)) { skipped.push(file); continue; }
    const sql = readFileSync(join(dir, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return { applied, skipped };
}

// CLI: pnpm --filter @kitchen/db migrate
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.PG_URL;
  if (!url) { console.error('PG_URL is required'); process.exit(1); }
  const pool = makePool(url);
  migrate(pool)
    .then((r) => {
      console.log('applied:', r.applied.join(', ') || '(none)');
      console.log('skipped:', r.skipped.join(', ') || '(none)');
    })
    .catch((err) => { console.error(err); process.exit(1); })
    .finally(() => pool.end());
}
