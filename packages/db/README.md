# @kitchen/db

Postgres реалізація `Repo` з `@kitchen/domain` + раннер міграцій.

## Що всередині

- `pool.ts` — обгортка над `pg.Pool`
- `migrate.ts` — читає `migrations/*.sql` за алфавітом, застосовує ті, яких нема в `schema_migrations`, транзакція на кожну
- `postgres-repo.ts` — реалізація `Repo`
- `tests/postgres-repo.test.ts` — той самий контракт, що для `InMemoryRepo`; викликається з `@kitchen/domain/contract`

## Запуск міграцій

```bash
PG_URL=postgresql://kitchen:kitchen@localhost:5433/kitchen pnpm --filter @kitchen/db migrate
```

CLI друкує applied/skipped. Ідемпотентно — можна запускати повторно.

## Тести

Дві дороги до бази:

1. `PG_TEST_URL=postgresql://...` — використовуємо як є (швидше на CI, який має свій pg)
2. Інакше — `@testcontainers/postgresql` піднімає ефемерний Postgres у Docker

Якщо ні одного, ні іншого — скіп з причиною. Це навмисне: обіцянка «зелений локально без Docker» цінна, але прогалину має бути видно.

## Мапінг типів

- `numeric` → JS `number` через `Number(r.field)`; для великих чисел, які втратять точність, це доведеться замінити на `bignumber.js`. Наразі — вага, впевненість, ккал, нічого дуже великого.
- `timestamptz` → ISO string
- `text[]` → JS `string[]` (pg парсить сам)
- `jsonb` → parsed object на читання; `JSON.stringify` на запис (Postgres коерсить текст → jsonb на INSERT/UPDATE)

## Свідомі спрощення

- `findBatchByLabel` — фетчить усі не-depleted партії дому і фільтрує в JS через `normalize()` із `@kitchen/catalog`. Для 135 партій це швидко. Коли доми виростуть — додати згенеровану колонку `normalized_label` і GIN(trgm) на неї, і робити перший фільтр у SQL.
- `updateBatch` і `updatePending` будують SQL за ключами обʼєкта. Колонок мало, ін'єкції неможливі (ключі приходять із наших типів), але при додаванні полів слідкуй, щоб TS-поле й SQL-колонка називались однаково.
