import pg from 'pg';

// Один пул на процес. У тестах створюємо окремий пул на контейнер і закриваємо.
export function makePool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 10 });
  // jsonb приходить як string за замовчуванням із деякими типами — вмикаємо парсинг.
  pool.on('error', (err) => console.error('pg pool error', err));
  return pool;
}

export type Pool = pg.Pool;
