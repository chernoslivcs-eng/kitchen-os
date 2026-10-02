// Звіт маркетингу docs/signup-sources.sql — сирий SQL поза репозиторієм, і
// жоден інший тест його не виконує. Тут він ганяється проти справжнього
// Postgres на засіяних домах: що запит узагалі розбирається і що числа в ньому
// ті, які обіцяє шапка файла. Без бази (локально) — скіп, як і контракт.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { makePool, migrate, PostgresRepo, type Pool } from '../index.js';
import { startDemo } from '@kitchen/domain/subscription';
import type { SignupSourceRow } from '@kitchen/domain/signup-source';
import { pickBackend } from './backend.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(HERE, '..', '..', '..', 'docs', 'signup-sources.sql'), 'utf-8');

const backend = await pickBackend();

if ('skip' in backend) {
  describe.skip(`звіт джерел реєстрації · ${backend.skip}`, () => {
    it('skipped', () => {});
  });
} else {
  describe('звіт джерел реєстрації (docs/signup-sources.sql)', () => {
    let pool: Pool;
    let repo: PostgresRepo;
    // Мітки унікальні на прогін: база спільна з контрактом, і чужі рядки
    // signup_source не мусять потрапити в наші числа.
    const tag = randomUUID().slice(0, 8);
    const LI = `linkedin-${tag}`;
    const IG = `instagram-${tag}`;
    const REF = `olena-${tag}`;

    const none = { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, ref: null };
    async function home(over: Partial<SignupSourceRow>, life: { pantry?: boolean; cook?: boolean; state?: 'demo' | 'active' } = {}) {
      const { user_id, household_id } = await repo.createUserWithHousehold(`rep-${randomUUID()}@x.test`, 'R');
      await repo.saveSignupSource({ user_id, household_id, via: 'email', ...none, created_at: new Date().toISOString(), ...over });
      const now = new Date().toISOString();
      // Сіємо методами репозиторію, а не сирим INSERT: їх уже ганяє контракт,
      // і тест не мусить знати колонки чужих таблиць.
      if (life.pantry) {
        await repo.insertBatch({
          id: randomUUID(), household_id, catalog_key: null, label: 'Моцарела', zone: 'fridge', value: 1, unit: 'pcs',
          state: 'sealed', opened_at: null, expires_at: null, best_before_opened_days: 3, added_at: now, depleted_at: null,
          confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: 'add',
        });
      }
      if (life.cook) {
        const recipe_id = randomUUID();
        await repo.saveRecipe({
          id: recipe_id, owner_id: user_id, origin: 'imported', title: 'Борщ', descr: null, character: null, risk: null,
          base_servings: 2, time_total: null, nutrition: null, payload: { t: 'Борщ', ing: [], st: [] }, created_at: now, saved_at: now,
        });
        await repo.saveCookRun({
          id: randomUUID(), household_id, user_id, recipe_id, servings: 2, started_at: now, finished_at: now,
          rating: null, verdict: null, photo_url: null, changes: null, undone_at: null,
        });
      }
      if (life.state) {
        await repo.saveSubscription({ ...startDemo(household_id, new Date()), state: life.state });
      }
      return { user_id, household_id };
    }

    beforeAll(async () => {
      pool = makePool(backend.url);
      await migrate(pool);
      repo = new PostgresRepo(pool);
      // LinkedIn: три доми — усі мертві, крім одного з коморою, одного з усім.
      await home({ utm_source: LI, utm_medium: 'social', utm_campaign: 'launch' });
      await home({ utm_source: LI, utm_medium: 'social', utm_campaign: 'launch', via: 'google' }, { pantry: true, state: 'demo' });
      await home({ utm_source: LI, utm_medium: 'social', utm_campaign: 'launch', via: 'google' }, { pantry: true, cook: true, state: 'active' });
      // Instagram: один дім, готував, але не платить.
      await home({ utm_source: IG, via: 'telegram' }, { pantry: true, cook: true, state: 'demo' });
      // Експерт: лише ref, без utm_source.
      await home({ ref: REF }, { state: 'active' });
      // Запрошений у чужий дім з міткою LinkedIn — у реєстрації не входить.
      const guest = await repo.createUserOnly(`rep-guest-${randomUUID()}@x.test`, 'G');
      await repo.saveSignupSource({ user_id: guest, household_id: null, via: 'invite', ...none, utm_source: LI, created_at: new Date().toISOString() });
    });

    afterAll(async () => {
      await pool.end();
      await backend.stop?.();
    });

    it('три запити; числа по джерелах сходяться з посіяним', async () => {
      const results = (await pool.query(SQL)) as unknown as { rows: Record<string, unknown>[] }[];
      expect(results).toHaveLength(3);
      const [bySource, byCampaign, invited] = results.map((r) => r.rows);

      const mine = (rows: Record<string, unknown>[]) => rows.filter((r) => String(r.source).includes(tag));
      const num = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v]));

      expect(mine(bySource!).map(num)).toEqual([
        { source: LI, signups: 3, with_pantry: 2, with_cook: 1, active_subs: 1 },
        { source: IG, signups: 1, with_pantry: 1, with_cook: 1, active_subs: 0 },
        { source: `ref:${REF}`, signups: 1, with_pantry: 0, with_cook: 0, active_subs: 1 },
      ]);

      // Той самий LinkedIn розпадається за способом входу; сума — ті самі три доми.
      const li = mine(byCampaign!).map(num).filter((r) => r.source === LI);
      expect(li).toEqual([
        { source: LI, utm_medium: 'social', utm_campaign: 'launch', utm_content: null, ref: null, via: 'google', signups: 2, with_pantry: 2, with_cook: 1, active_subs: 1 },
        { source: LI, utm_medium: 'social', utm_campaign: 'launch', utm_content: null, ref: null, via: 'email', signups: 1, with_pantry: 0, with_cook: 0, active_subs: 0 },
      ]);

      expect(mine(invited!).map(num)).toEqual([{ source: LI, invited: 1 }]);
    });
  });
}
