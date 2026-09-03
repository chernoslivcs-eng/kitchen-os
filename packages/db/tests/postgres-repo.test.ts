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

interface Ctx {
  pool: Pool;
  stop?: () => Promise<void>;
}

async function pickBackend(): Promise<Ctx | { skip: string }> {
  const url = process.env.PG_TEST_URL;
  if (url) {
    const pool = makePool(url);
    return { pool };
  }
  try {
    const mod = await import('@testcontainers/postgresql');
    const container = await new mod.PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('kitchen')
      .withUsername('kitchen')
      .withPassword('kitchen')
      .start();
    const pool = makePool(container.getConnectionUri());
    return { pool, stop: async () => { await pool.end(); await container.stop(); } };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    return { skip: `Docker недоступний (${msg.slice(0, 80)}) і PG_TEST_URL не задано` };
  }
}

const backend = await pickBackend();

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
      await pool.query('TRUNCATE household_invite, token_usage, auth_challenge, auth_session, attachment, card_pending, pantry_batch, household_product, memory_note, message, session, cook_run, recipe, shopping_item, eater, household_member, profile, household_event, household_occasion_mute, household, "user" RESTART IDENTITY CASCADE');
      const household_id = randomUUID();
      const user_id = randomUUID();
      await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [user_id, 'Test', `test-${user_id}@x.local`]);
      await pool.query('INSERT INTO household (id, name) VALUES ($1, $2)', [household_id, 'Test HH']);
      await pool.query('INSERT INTO household_member (household_id, user_id, role) VALUES ($1, $2, $3)', [household_id, user_id, 'owner']);
      return { repo, household_id, user_id };
    },
    async teardown() {
      if (stop) await stop();
      else await pool.end();
    },
  });
}
