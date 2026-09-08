// ТІЛЬКИ читання: перевірка, до якої бази ми підключились.
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.URL_!, max: 2 });
const q = async (s: string, a: unknown[] = []) => (await pool.query(s, a)).rows;
console.log('database:', (await q('SELECT current_database() db, version() v'))[0].db);
console.log('households:', (await q('SELECT count(*) n FROM household'))[0].n);
console.log('users:', (await q('SELECT count(*) n FROM "user"'))[0].n);
console.log('batches:', (await q('SELECT count(*) n FROM pantry_batch'))[0].n);
console.log('card_pending:', (await q('SELECT count(*) n FROM card_pending'))[0].n);
console.log('\nтоп домів за партіями:');
for (const r of await q(`SELECT household_id, count(*) FILTER (WHERE state <> 'depleted') active, count(*) total
                           FROM pantry_batch GROUP BY 1 ORDER BY active DESC LIMIT 5`)) console.log(' ', r.household_id, 'активних', r.active, 'усього', r.total);
await pool.end();
