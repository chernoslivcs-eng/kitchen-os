// ТІЛЬКИ читання: коли зʼявилось вето і чи росла комора.
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.URL_!, max: 2 });
const HH = 'f1ed1365-9f44-4c58-855f-4d1f883b4d21';
const q = async (s: string, a: unknown[] = []) => (await pool.query(s, a)).rows;
console.log('=== схема veto_index ===');
for (const r of await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='veto_index' ORDER BY ordinal_position`)) console.log(' ', r.column_name, r.data_type);
const uid = (await q('SELECT user_id FROM household_member WHERE household_id=$1 AND role=$2 LIMIT 1',[HH,'owner']))[0].user_id;
console.log('\n=== рядки вето власника ===');
console.log(JSON.stringify(await q('SELECT * FROM veto_index WHERE user_id=$1', [uid]), null, 1).slice(0, 800));
console.log('\n=== коли востаннє чіпали профіль (звідки береться вето) ===');
for (const r of await q(`SELECT column_name FROM information_schema.columns WHERE table_name='profile_text' ORDER BY ordinal_position`)) process.stdout.write(r.column_name+' ');
console.log('');
console.log(JSON.stringify(await q(`SELECT * FROM profile_text WHERE user_id=$1 LIMIT 3`, [uid]), null, 1).slice(0, 900));
console.log('\nvet_index: max(id) =', (await q('SELECT max(id) m, count(*) n FROM veto_index'))[0]);
console.log('\n=== партії за датою додавання (чи росла комора) ===');
for (const r of await q(`SELECT date_trunc('day', added_at)::date d, count(*) n FROM pantry_batch
                          WHERE household_id=$1 AND state <> 'depleted' GROUP BY 1 ORDER BY 1 DESC LIMIT 10`,[HH]))
  console.log(' ', r.d.toISOString().slice(0,10), r.n);
console.log('\nусього активних:', (await q(`SELECT count(*) n FROM pantry_batch WHERE household_id=$1 AND state<>'depleted'`,[HH]))[0].n);
console.log('із catalog_key:', (await q(`SELECT count(*) n FROM pantry_batch WHERE household_id=$1 AND state<>'depleted' AND catalog_key IS NOT NULL`,[HH]))[0].n);
console.log('із product_id:', (await q(`SELECT count(*) n FROM pantry_batch WHERE household_id=$1 AND state<>'depleted' AND product_id IS NOT NULL`,[HH]))[0].n);
await pool.end();
