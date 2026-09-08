// ТІЛЬКИ читання. Розкладка обробника /v1/pantry по частинах на ПРОДІ.
import pg from 'pg';
import { PostgresRepo } from './postgres-repo.js';
import { pantryItemView } from '@kitchen/domain';
import { BY_KEY } from '@kitchen/catalog/seed';

const HH = 'f1ed1365-9f44-4c58-855f-4d1f883b4d21';
const t0 = performance.now();
const pool = new pg.Pool({ connectionString: process.env.URL_!, max: 4 });
const repo = new PostgresRepo(pool);
// Перший запит несе встановлення зʼєднання й SSL-рукостискання до Neon.
const tConn = performance.now();
await pool.query('SELECT 1');
const connMs = Math.round(performance.now() - tConn);

const UID = (await pool.query(
  'SELECT user_id FROM household_member WHERE household_id=$1 AND role=$2 LIMIT 1', [HH, 'owner'])).rows[0].user_id;

async function run(tag: string) {
  const p: Record<string, number> = {};
  const s0 = performance.now();
  let t = performance.now(); const all = await repo.listBatches(HH); p.listBatches = Math.round(performance.now()-t);
  const active = all.filter((b) => b.state !== 'depleted');
  t = performance.now(); const raw = await repo.listProducts(HH); p.listProducts = Math.round(performance.now()-t);
  t = performance.now();
  const products = raw.map((x) => { const c = x.catalog_key ? BY_KEY.get(x.catalog_key) : undefined;
    return c ? { ...x, search_terms: [...new Set([...c.categories, ...c.aliases, c.name.toLowerCase()])] } : x; });
  p.search_terms = Math.round(performance.now()-t);
  t = performance.now(); const veto = await repo.getVetoIndex(UID); p.getVetoIndex = Math.round(performance.now()-t);
  t = performance.now(); const last = await repo.lastAppliedIntake(HH, new Date(Date.now()-365*86400000)); p.lastAppliedIntake = Math.round(performance.now()-t);
  const ids = new Set(last?.created_batch_ids ?? []);
  t = performance.now();
  const byId = new Map(products.map((x) => [x.id, x])); const now = Date.now();
  const batches = active.map((b) => ({ ...b, ...pantryItemView(b, b.product_id ? byId.get(b.product_id) : undefined, veto, ids, now) }));
  p['map(pantryItemView)'] = Math.round(performance.now()-t);
  t = performance.now(); const body = JSON.stringify({ household_id: HH, count: active.length, batches, products, last_receipt_at: last?.applied_at ?? null });
  p['JSON.stringify'] = Math.round(performance.now()-t);
  p.TOTAL = Math.round(performance.now()-s0);
  p['  партій активних'] = active.length; p['  продуктів'] = products.length; p['  тіло, kb'] = Math.round(body.length/1024);
  console.log(`\n--- ${tag} ---`);
  for (const [k,v] of Object.entries(p)) console.log(k.padEnd(24), v);
}
console.log('імпорт+пул, мс:', Math.round(tConn - t0), '| перше зʼєднання до Neon, мс:', connMs);
await run('прогін 1'); await run('прогін 2'); await run('прогін 3');
await pool.end();
