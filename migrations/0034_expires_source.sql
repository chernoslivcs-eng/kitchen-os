-- Р4 (рішення власника 10.09), етап 2b редизайну v3.
--
-- `expires_at` має ДВОХ писачів, і розрізнити їх досі було нічим:
--   · картка комори — людина поставила дату руками (routes/pantry.ts:205);
--   · відкриття партії — `expiryOnOpen` порахував від `shelf_open_days`
--     (routes/pantry.ts:222, apply.ts гілки `open` і `correct`).
--
-- Через це макет обіцяв те, чого дані не несуть: перемикач «поставити дату» і
-- підпис «строк поставила людина» не мали під собою ознаки. Тип `ShelfSource`
-- у домені існував з першого дня («Поки всі — category»), але в партію не
-- писався ніколи.
--
-- Значення — те саме, що `ShelfSource` у packages/domain/shelf-life.ts:
--   'manual'      — дату вписала людина; вона старша за будь-який розрахунок;
--   'category'    — дата порахована від правила каталогу (відкриття);
--   NULL          — колонка порожня, строк рахується на льоту.
alter table pantry_batch add column if not exists expires_source text;

comment on column pantry_batch.expires_source is
  'Звідки expires_at: manual — людина, category — правило каталогу на відкритті, NULL — не ставили.';
