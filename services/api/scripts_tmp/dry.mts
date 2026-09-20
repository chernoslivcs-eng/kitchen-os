// Dry-run вечірнього нагадування на домі власника — ЛИШЕ читання: Proxy над PostgresRepo
// перетворює кожен write-метод на no-op; сесія — фейкова; токен не зберігається.
import { makePool, PostgresRepo } from '@kitchen/db';
import type { Repo, ShoppingItemRow } from '@kitchen/domain';
import { runDigestFor } from '../src/digest.js';

const WRITE = /^(save|insert|update|set|delete|remove|consume|revoke|link|create|mark|touch|apply|dismiss|undo|record|append|put|upsert|add|attach|merge|rekey|backfill|clear|reset|enqueue|bump|increment|log|open|close|finish|start|patch|rename|deplete|restore|seed|migrate)/i;
function readOnly(real: Repo, fakeList?: ShoppingItemRow[]): Repo {
  return new Proxy(real, {
    get(t, prop: string) {
      const v = (t as unknown as Record<string, unknown>)[prop];
      if (typeof v !== 'function') return v;
      if (prop === 'getOrCreateSessionForDay') return async (user_id: string, day: string) => ({ id: '00000000-0000-4000-8000-000000000000', user_id, day, title: 'dry', created_at: new Date().toISOString() });
      if (prop === 'listShoppingItems' && fakeList) return async () => fakeList;
      if (prop === 'getSession') return async () => null;
      if (WRITE.test(prop)) return async (...a: unknown[]) => { console.error(`  [no-op write] ${prop}`); return prop === 'saveRecipe' ? undefined : undefined; };
      return (v as (...a: unknown[]) => unknown).bind(t);
    },
  });
}
const pool = makePool(process.env.PG_URL!);
const real = new PostgresRepo(pool);
const email = process.argv[2]!;
const user = await real.findUserByEmail(email);
if (!user) throw new Error('no user');
const tg = await real.getTelegramByUser(user.id);
const household_id = await real.firstHouseholdOf(user.id);
if (!tg || !household_id) throw new Error('no telegram or household');
const c = { user_id: user.id, household_id, chat_id: tg.chat_id ?? 0, tz: null, digest_enabled: true, digest_sent_on: null };
const now = new Date(); const kyiv18 = new Date(); kyiv18.setUTCHours(15, 30, 0, 0);
const log = { info: () => {}, warn: (o: unknown, m: string) => console.error('  warn', m, JSON.stringify(o).slice(0, 160)), error: console.error, debug: () => {}, trace: () => {}, fatal: console.error, child() { return log; } } as never;
const fake: ShoppingItemRow[] = ['хліб', 'молоко', 'лимони', 'вершки 33%'].map((label, i) => ({ id: `f${i}`, household_id: c.household_id, label, reason: null, value: null, unit: null, zone: null, checked: false, added_by: null, source: 'user', created_at: now.toISOString() }));
for (const [name, list] of [['реальний стан', undefined], ['підставлений список', fake]] as const) {
  for (let i = 0; i < 2; i++) {
    const repo = readOnly(real, list);
    const t0 = Date.now();
    const r = await runDigestFor({ repo, store: {} as never, chatOpts: {}, appUrl: 'https://kitchen-os-coral.vercel.app', log, now: () => kyiv18, webTokenSecret: 'dry', send: async () => {} }, { ...c, digest_sent_on: null, digest_enabled: true });
    console.log(`===== ${name} · ${i + 1} · ${Date.now() - t0} мс`);
    if (r.status === 'sent') { console.log(r.text); console.log(`[${r.button.text}] → next=${decodeURIComponent(r.button.url.split('next=')[1] ?? '')}  · form=${r.form} voice=${r.voice}`); }
    else console.log(JSON.stringify(r));
  }
}
await pool.end();
