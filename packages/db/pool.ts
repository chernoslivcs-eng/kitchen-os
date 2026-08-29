import pg from 'pg';

// Один пул на процес. У тестах створюємо окремий пул на контейнер і закриваємо.
// На serverless (Vercel) канон — мало конекшенів на інстанс, пулінг робить Neon.
// Ліміт 1024 fd на функцію легко зʼїсти при 10×N паралельних cold start'ів.
export function makePool(connectionString: string): pg.Pool {
  const max = Number(process.env.PG_POOL_MAX ?? (process.env.VERCEL ? 2 : 10));
  const pool = new pg.Pool({ connectionString, max });
  pool.on('error', (err) => console.error('pg pool error', err));
  return pool;
}

export type Pool = pg.Pool;
