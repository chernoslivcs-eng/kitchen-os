// ТІЛЬКИ читання і EXPLAIN. Нічого не міняємо — звіт до правки.
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.URL_!, max: 2 });
const HH = 'f1ed1365-9f44-4c58-855f-4d1f883b4d21';
const since = new Date(Date.now() - 365 * 86_400_000);
const q = async (s: string, a: unknown[] = []) => (await pool.query(s, a)).rows;

console.log('=== 1. card_pending цього дому ===');
console.log(JSON.stringify((await q(
  `SELECT count(*) total,
          count(*) FILTER (WHERE applied_at IS NOT NULL AND undone_at IS NULL) applied_live,
          count(*) FILTER (WHERE card->>'type' = 'intake_diff') intake,
          count(*) FILTER (WHERE applied_at IS NOT NULL AND undone_at IS NULL AND card->>'type'='intake_diff') hits,
          count(*) FILTER (WHERE applied_at > $2) year_window,
          pg_size_pretty(sum(pg_column_size(card))::bigint) card_bytes,
          pg_size_pretty(sum(pg_column_size(coalesce(undo_snapshot,'{}'::jsonb)))::bigint) snap_bytes,
          pg_size_pretty(max(pg_column_size(card))::bigint) max_card
     FROM card_pending WHERE household_id = $1`, [HH, since]))[0], null, 2));

console.log('\n=== 2. розмір таблиць ===');
for (const r of await q(`SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) total,
                                pg_size_pretty(pg_relation_size(c.oid)) heap,
                                (SELECT pg_size_pretty(sum(pg_total_relation_size(t.oid))) FROM pg_class t WHERE t.oid = c.reltoastrelid) toast
                           FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                          WHERE n.nspname='public' AND relname IN ('card_pending','pantry_batch','household_product','message')`))
  console.log(' ', r.relname, '| всього', r.total, '| heap', r.heap, '| toast', r.toast);

console.log('\n=== 3. індекси card_pending ===');
for (const r of await q(`SELECT indexname FROM pg_indexes WHERE tablename='card_pending'`)) console.log(' ', r.indexname);

console.log('\n=== 4. чи був ANALYZE ===');
console.log(JSON.stringify((await q(
  `SELECT relname, n_live_tup, last_analyze, last_autoanalyze, last_vacuum, last_autovacuum
     FROM pg_stat_user_tables WHERE relname IN ('card_pending','pantry_batch','household_product')`)), null, 2));

console.log('\n=== 5. EXPLAIN lastAppliedIntake (новий запит) ===');
const narrow = `SELECT cp.applied_at, cp.card->'source' AS source, cp.undo_snapshot->'before'->'created_batch_ids' AS ids
   FROM card_pending cp
  WHERE cp.household_id = $1 AND cp.applied_at IS NOT NULL AND cp.undone_at IS NULL
    AND cp.applied_at > $2 AND cp.card->>'type' = 'intake_diff'
    AND jsonb_typeof(cp.card->'source') = 'object'
  ORDER BY cp.applied_at DESC LIMIT 1`;
for (const r of await q(`EXPLAIN (ANALYZE, BUFFERS) ${narrow}`, [HH, since])) console.log(r['QUERY PLAN']);

console.log('\n=== 6. EXPLAIN старого listRecentResolved (для порівняння) ===');
const old = `SELECT cp.* FROM card_pending cp JOIN message m ON m.id = cp.message_id
  WHERE cp.household_id = $1
    AND (cp.applied_at IS NOT NULL OR cp.undone_at IS NOT NULL OR cp.dismissed_at IS NOT NULL)
    AND GREATEST(COALESCE(cp.applied_at,'-infinity'),COALESCE(cp.undone_at,'-infinity'),COALESCE(cp.dismissed_at,'-infinity')) > $2
  ORDER BY GREATEST(COALESCE(cp.applied_at,'-infinity'),COALESCE(cp.undone_at,'-infinity'),COALESCE(cp.dismissed_at,'-infinity')) DESC
  LIMIT 300`;
for (const r of await q(`EXPLAIN (ANALYZE, BUFFERS) ${old}`, [HH, since])) console.log(r['QUERY PLAN']);
await pool.end();
