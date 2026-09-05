// Той самий контракт, що для InMemoryRepo — але проти справжнього Postgres.
// Дві дороги до бази:
//   1) PG_TEST_URL="postgresql://user:pass@host:port/db" → використовуємо як є
//   2) інакше — @testcontainers/postgresql піднімає ефемерний контейнер
// Якщо ні PG_TEST_URL, ні Docker — скіп із причиною. CI без Docker/PG залишається зеленим,
// але прогалину видно в консолі, як для shelf-photo в eval.

import { describe, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { makePool, migrate, PostgresRepo, seedCatalog, seedOccasions, type Pool } from '../index.js';
import { describeRepoContract } from '@kitchen/domain/contract';
import { pickBackend } from './backend.js';

interface Ctx {
  pool: Pool;
  stop?: () => Promise<void>;
}

async function pickCtx(): Promise<Ctx | { skip: string }> {
  const b = await pickBackend();
  if ('skip' in b) return b;
  const pool = makePool(b.url);
  return { pool, stop: async () => { await pool.end(); await b.stop?.(); } };
}

const backend = await pickCtx();

if ('skip' in backend) {
  describe.skip(`PostgresRepo · ${backend.skip}`, () => {
    it('skipped', () => {});
  });
} else {
  const { pool, stop } = backend;
  await migrate(pool);
  // Каталог під FK household_product.catalog_key — контракт тегера чекає
  // 'cambozola_cheese' у довіднику.
  await seedCatalog(pool);
  // Довідник подій — теж передумова контракту: listOccasionCatalog має віддати
  // ті самі рядки, що InMemoryRepo бере з констант домену.
  await seedOccasions(pool);
  const repo = new PostgresRepo(pool);

  describeRepoContract('PostgresRepo', {
    async make() {
      // Чистимо між тестами й сіємо household + user під FK.
      await pool.query('TRUNCATE household_invite, token_usage, auth_challenge, auth_session, attachment, card_pending, pantry_batch, household_product, memory_note, message, session, cook_run, recipe, shopping_item, eater, household_member, profile, profile_text, profile_note, veto_index, household_event, user_occasion_mute, household_occasion_catch, household, "user" RESTART IDENTITY CASCADE');
      const household_id = randomUUID();
      const user_id = randomUUID();
      // Другий учасник того самого дому — під приватність календаря. Справжній
      // рядок, а не вигаданий uuid: created_by це FK на "user".
      const other_user_id = randomUUID();
      await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [user_id, 'Test', `test-${user_id}@x.local`]);
      await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [other_user_id, 'Other', `other-${other_user_id}@x.local`]);
      await pool.query('INSERT INTO household (id, name) VALUES ($1, $2)', [household_id, 'Test HH']);
      await pool.query('INSERT INTO household_member (household_id, user_id, role) VALUES ($1, $2, $3)', [household_id, user_id, 'owner']);
      await pool.query('INSERT INTO household_member (household_id, user_id, role) VALUES ($1, $2, $3)', [household_id, other_user_id, 'member']);
      return { repo, household_id, user_id, other_user_id };
    },
    async teardown() {
      await stop!();
    },
  });
}
