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
- Крок 3б (облік токенів) — `token_usage` рядок на кожен виклик моделі (стаб теж, з `mode='stub'`). Міграція `0003_token_usage.sql`. У проді фільтрувати `mode='live'`.
- Крок 3в (запрошення в дім) — `POST /v1/households/:id/invite`, `POST /v1/invites/:id/revoke`, `GET /v1/invites/accept?token=`. Той самий каркас, що magic-link: `token_hash` SHA-256, одноразовий, TTL 7 днів, revocable. Клік по лінку сам логінить запрошеного і додає в `household_member`. Міграція `0004_household_invite.sql`. **Продуктова модель:** дім = сімейний, magic-link = оформлення підписки (юзер + власний дім), invite = гостьовий ключ (юзер без власного дому, тільки membership у чужому). Аналогія — сімейний Netflix: один акаунт, кілька профілів, у кожного окрема історія, але бібліотека одна.
- Крок 3г (прод-готовність auth) — `SmtpMailer` через nodemailer (працює з Resend/SES/будь-яким SMTP), вибір через `SMTP_HOST` env. Власний rate limiter (без `@fastify/rate-limit`, бо його hook у v10 несумісний з нашим порядком preHandler'ів): 5/15хв на IP+email для `/v1/auth/request`, 20/год на user_id для `/v1/households/:id/invite`. Битий email рахується як спроба (щоб scanner не обходив ліміт).
- Крок 4 (опора для фронту) — `GET /v1/me` (юзер + активний дім + учасники) і `GET /v1/pantry` (партії активного дому, відсортовані за терміновістю). Мінімум, який фронт хоче показати одразу після входу. Мультидомний перемикач — наступним кроком, коли UI буде.
- Крок 5 (apps/web — фундамент) — Vite + React + TS, дизайн-токени як CSS custom properties (темна + світла тема), Zustand для auth, API-клієнт із cookie credentials, react-router-dom. Компонентна база: `Logo`, `Button`, `Input`, `MonoLabel`. Два auth-екрани з брифу: «01 Вхід» і «02 Лист надіслано». Замкнений цикл вхід → лист → cookie → `/app` (плейсхолдер стрічки).
- Далі: стрічка (04), комора (05), пропозиція (08), рецепт (09), Cook Mode (10), список (06), рецепти (07), профіль (11), фото-інтейк (12), онбординг (03), десктопні варіанти.
- Далі: звірка `allergen_groups` на 115 нових позицій каталогу, розширення каталогу до 1500-2500, мережа Сільпо, household switch UI.

## Postgres: Neon або локально

`.env` у корені монорепо тримає всі секрети — `PG_URL`, `PG_TEST_URL`, `ANTHROPIC_API_KEY`, `SMTP_*`, `APP_URL`. Раннер бекенду, міграцій і eval сам його завантажує; **shell-експорту не потрібно**.

**Neon (production + dev branch)**:
```bash
# .env містить PG_URL (production pooler) і PG_TEST_URL (dev pooler)
pnpm --filter @kitchen/db migrate     # прогнати migrations/*.sql на PG_URL
pnpm --filter @kitchen/db test        # тести проти PG_TEST_URL
```

**Docker локально**:
```bash
docker compose up -d postgres         # порт 5433
# у .env поклади: PG_URL=postgresql://kitchen:kitchen@localhost:5433/kitchen
pnpm --filter @kitchen/db migrate
pnpm --filter @kitchen/api start
```

Без обраних опцій — задай `PG_TEST_URL` до будь-якого свого Postgres 16 з розширеннями `pg_trgm`, `unaccent`, `pgcrypto`. Тести `packages/db` тоді запустяться проти нього. Інакше скіп із причиною.

## Локальний запуск фронту + бекенду

```bash
# .env у корені (мінімум): PG_URL=..., APP_URL=http://localhost:5173

# Термінал 1 — бекенд на :3000
pnpm --filter @kitchen/api start

# Термінал 2 — фронт на :5173
pnpm --filter @kitchen/web dev
```

Vite проксить `/v1/*` на fastify:3000, cookie `kos` лягає на 5173, magic-link теж повертається сюди. Введи email → `202` → на фронті редирект на `/sent`. У stdout fastify побачиш `[mail] magic link → …` (`ConsoleMailer` без SMTP). Клікни лінк — потрапиш через `/v1/auth/verify` на `/app`.

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
