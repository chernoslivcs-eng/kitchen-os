# Kitchen OS

Продакшн-репозиторій «Кухні». Прототип живе поруч (`kitchen-prototype.jsx`) і мігрує порціями.
Специфікація — файли `00-README.md` … `05-risks.html` у корені.

## Стан

- Крок 0 (інфраструктура перевірки) — зроблено. `pnpm eval` віддає діф до baseline.
- Крок 1 (каталог) — 131 позиція (16 стартових + 115 із реального інвентарю домогосподарства), три критеріальні тести проходять. `allergen_groups` на нових 115 — перший прохід, не звірений зі складом, не покладатись для реальних алергій.
- Крок 2 (ядро) — міграція, домен, `services/api` з `/v1/chat`, `/v1/cards/:id/apply`, `/v1/cards/:id/undo`. Два бекенди: `InMemoryRepo` за замовчуванням, `PostgresRepo` при заданому `PG_URL`.
- Крок 2а (Postgres) — `packages/db` з реалізацією Repo проти pg + міграційним раннером. Контракт домену прогоняється проти обох реалізацій (InMemory + Postgres) із того самого файлу [`packages/domain/contract.ts`](packages/domain/contract.ts) — це гарантує, що дрейф між реалізаціями ловиться тестом. **Тестовано проти Neon**: 8/8 тестів PostgresRepo пройшли на dev branch; міграції `0001_init.sql` застосовані; три архітектурні правила підтверджені.**
- Крок 3 (вкладення) — `POST /v1/attachments` (multipart), `/v1/chat { attachments: [{id}] }` маршрутизує на `attachment_parse` (temperature 0), `POST /v1/attachments/:id/reparse` для повторного розбору з підказкою. Обʼєктне сховище через `AttachmentStore` (`LocalFSStore` + `InMemoryStore`); S3 — окрема реалізація.
- Крок 3а (auth) — magic-link + серверні сесії. Три ендпоінти: `POST /v1/auth/request`, `GET /v1/auth/verify?token=`, `POST /v1/auth/logout`. Cookie `kos` (httpOnly, sameSite=lax). Всі захищені ендпоінти (chat, cards, attachments) беруть `user_id`/`household_id` із сесії, а не з тіла запиту. Пошта — інтерфейс `Mailer` з `ConsoleMailer` для дев/тестів; прод-провайдер (Resend/SES/SMTP) — окремий крок. Міграція `0002_auth.sql`.
- Дім — дані вже є (`household`, `household_member`, `pantry_batch` прив'язана до `household_id`, `profile` до `user_id`). Створення юзера через magic-link одразу створює його дім. Запрошення в дім посиланням — окремий крок.
- Далі: облік токенів на користувача (зараз рахується, але ніде не пишеться), запрошення в дім посиланням, прод-мейлер, мережа.

## Postgres: Neon або локально

**Neon (production & dev)**:
```bash
# .env містить PG_URL (production pooler) і PG_TEST_URL (dev pooler)
PG_URL="..." pnpm --filter @kitchen/db migrate     # прогнати на dev branch
PG_TEST_URL="..." pnpm --filter @kitchen/db test   # тести проти dev branch
```

**Docker локально**:
```bash
docker compose up -d postgres         # порт 5433
export PG_URL=postgresql://kitchen:kitchen@localhost:5433/kitchen
pnpm --filter @kitchen/db migrate     # прогнати migrations/*.sql
pnpm --filter @kitchen/api start      # api з PostgresRepo
```

Без обраних опцій — задай `PG_TEST_URL` до будь-якого свого Postgres 16 з розширеннями `pg_trgm`, `unaccent`, `pgcrypto`. Тести `packages/db` тоді запустяться проти нього. Інакше скіп із причиною — CI лишається зеленим, але «прогалину видно».

## Структура

```
apps/api                       (порожньо; fastify + drizzle пізніше)
apps/web                       (порожньо; vite + react + zustand пізніше)
services/                      (порожньо; окремі процеси, спільна БД)
packages/prompts               версіоновані .md, реєстр із версією
packages/eval                  фікстури + інваріанти + прогінник із дифом
packages/catalog               схема + сід + логіка збігу; проходить 3 критерії
migrations/                    SQL міграції Postgres (пізніше)
```

## Запуск

```bash
pnpm install
cp .env.example .env    # додай ANTHROPIC_API_KEY
pnpm eval               # прогін фікстур, діф до попереднього снапшоту
pnpm test               # тести каталогу
```

Без `ANTHROPIC_API_KEY` `pnpm eval` не викликає модель, лише перевіряє, що реєстр промптів вантажиться і інваріанти компілюються. Це навмисне — на CI без ключа ми хочемо ловити регресії скелета, а не мовчки скіпати їх.

## Три правила, які тримає інфраструктура

1. **Модель ніколи не пише в стан напряму.** Ендпоінт `chat` віддає картку; `cards/:id/apply` застосовує. Розділення жорстке — це не «дві функції», а два різні шляхи в БД.
2. **Модель показує пальцем, а не називає.** Рецепт містить `{"p":"p12"}`; текст для людини — назви. Інваріант `no-raw-ids-in-user-text` вибиває будь-яку відповідь, де в полі для людини протік `p12` чи `{p3}`.
3. **Інформація — репліка, дія — інтерфейс.** У `eval` немає інваріантів на «плашки» або «блоки»; є інваріант «одне-два речення в reply». Це стрижень, який ловить регресії з «звіту на 11 позицій».

## Що далі

`04-roadmap.html` розкладає це на шість етапів. Перший — каталог (`packages/catalog`). Крок 0 і каталог зроблено разом свідомо: без каталогу не проходять три критеріальні тести, які самі є частиною набору фікстур.
