// Сід календаря: константи домену → рядки occasion_catalog.
//
// Той самий патерн, що seedCatalog. Сенс той самий і в іншому: доки список
// свят жив лише в коді, змінити його можна було тільки деплоєм. Тепер код —
// джерело за замовчуванням, а таблиця — те, що можна правити ззовні.
//
// Ідемпотентний: ON CONFLICT DO UPDATE. Перекочування сіду не створює
// дублікатів і не гасить події, дописані поза кодом, — воно чіпає лише свої
// id. Редакційні події («день томатів») сюди не потрапляють ніколи: у них
// інше джерело, і сід не має права їх переписати.

import type { Pool } from './pool.js';
import { BUILTIN_OCCASIONS, isWindowRow } from '@kitchen/domain';

export async function seedOccasions(pool: Pool): Promise<number> {
  let upserted = 0;
  for (const row of BUILTIN_OCCASIONS) {
    const win = isWindowRow(row) ? row : null;
    // Сила виводиться з даних, а не дублюється полем: якщо є текст обмеження —
    // це обмеження. CHECK у міграції тримає той самий інваріант з боку БД.
    const force = win?.restricts ? 'restrict' : 'hint';
    await pool.query(
      `INSERT INTO occasion_catalog
         (id, kind, title, meaning, rule, force, restricts, tradition,
          buy, seeds, approx, upcoming_title, source, audience, published_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,NULL,now())
       ON CONFLICT (id) DO UPDATE SET
         kind = EXCLUDED.kind, title = EXCLUDED.title, meaning = EXCLUDED.meaning,
         rule = EXCLUDED.rule, force = EXCLUDED.force, restricts = EXCLUDED.restricts,
         tradition = EXCLUDED.tradition, buy = EXCLUDED.buy, seeds = EXCLUDED.seeds,
         approx = EXCLUDED.approx, upcoming_title = EXCLUDED.upcoming_title,
         source = EXCLUDED.source`,
      [
        row.id,
        row.type,
        row.title,
        win?.meaning ?? null,
        JSON.stringify(row.rule),
        force,
        win?.restricts ?? null,
        row.tradition ?? null,
        win?.buy ?? [],
        win?.seeds ?? [],
        isWindowRow(row) ? false : row.approx,
        win?.upcomingTitle ?? null,
        row.source ?? null,
      ],
    );
    upserted++;
  }
  return upserted;
}
