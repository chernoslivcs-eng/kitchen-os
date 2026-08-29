// Vitest setup для packages/db: підтягує PG_TEST_URL із .env у корені монорепо,
// щоб контрактні тести PostgresRepo побачили Neon dev branch. Без цього
// tests/postgres-repo.test.ts мовчки скіпається.

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
config({ path: rootEnv });
