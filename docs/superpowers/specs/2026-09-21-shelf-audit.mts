// Аудит строків комори власника: число, яке показує застосунок, і звідки воно. ПРОД — лише читання.
import fs from 'node:fs';
import pg from '/Users/philip/Work/2026_AI_CREATIVE/KITCHEN_OS/packages/db/node_modules/pg/lib/index.js';
import { effectiveExpiry, daysLeft } from '/Users/philip/Work/2026_AI_CREATIVE/KITCHEN_OS/.worktrees/stand-main/packages/domain/pantry-view.ts';
import { shelfSealedDays, shelfOpenDays } from '/Users/philip/Work/2026_AI_CREATIVE/KITCHEN_OS/.worktrees/stand-main/packages/domain/shelf-life.ts';
import { BY_KEY } from '/Users/philip/Work/2026_AI_CREATIVE/KITCHEN_OS/.worktrees/stand-main/packages/catalog/seed.ts';

const env = fs.readFileSync('/Users/philip/Work/2026_AI_CREATIVE/KITCHEN_OS/.env', 'utf8');
const url = env.split('\n').find((l) => l.startsWith('PG_URL='))!.slice(7).replace(/^["']|["']$/g, '');
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
const c = await pool.connect(); await c.query('SET default_transaction_read_only = on');
const u = (await c.query(`select id from "user" where email='chernosliv.cs@gmail.com'`)).rows[0];
const h = (await c.query(`select household_id from household_member where user_id=$1 limit 1`, [u.id])).rows[0].household_id;
const batches = (await c.query(`select * from pantry_batch where household_id=$1 and depleted_at is null order by zone, label`, [h])).rows;
const products = (await c.query(`select * from household_product where household_id=$1`, [h])).rows;
c.release(); await pool.end();
const byId = new Map(products.map((p: any) => [p.id, p]));
const now = Date.now();
const rows = batches.map((b: any) => {
  const prod = b.product_id ? byId.get(b.product_id) : undefined;
  const key = b.catalog_key ?? prod?.catalog_key ?? null;
  const item = key ? (BY_KEY as Map<string, any>).get(key) : undefined;
  const exp = effectiveExpiry(b, key, now);
  const days = daysLeft(exp, now);
  const sealedCat = shelfSealedDays(key, b.zone);
  const openCat = key ? shelfOpenDays(key) : undefined;
  let source: string;
  if (b.expires_at) source = 'ручна/відкриття expires_at';
  else if (!key) source = 'без категорії (числа нема)';
  else if (b.state === 'opened' && b.opened_at) source = `після відкриття: ${b.best_before_opened_days ?? openCat ?? '—'} дн від opened_at`;
  else if (sealedCat === null) source = 'каталог: не псується';
  else if (sealedCat === undefined) source = `дефолт зони ${b.zone}`;
  else source = `каталог, категорія (${(item?.categories ?? []).slice(0, 2).join('/')}): ${sealedCat} дн від added_at`;
  return { zone: b.zone, label: b.label, state: b.state, value: b.value, unit: b.unit, days, key, source, added: b.added_at.toISOString().slice(0, 10) };
});
fs.writeFileSync('/private/tmp/claude-501/-Users-philip-Work-2026-AI-CREATIVE-KITCHEN-OS/b840d607-c485-4bc5-b77d-fee974c0ffaa/scratchpad/shelf-audit.json', JSON.stringify(rows, null, 1));
for (const r of rows) console.log(`${r.zone}\t${r.state}\t${String(r.days ?? '—').padStart(4)}\t${r.label} · ${r.value ?? ''} ${r.unit ?? ''}\t[${r.key ?? '—'}]\t${r.source}`);
