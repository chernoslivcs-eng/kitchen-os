# Deploy: Vercel + Neon

Kitchen OS деплоїться як один Vercel-проєкт з корененем монорепи. Frontend
(Vite build) віддається як статика, backend (Fastify) — одна серверлес-функція
`api/index.ts`. БД — Neon Postgres (уже налаштовано в `.env`).

## Що потрібно один раз

1. **Vercel account + проєкт**
   - `vercel login`
   - `vercel link` в корені репозиторію → створити новий проєкт `kitchen-os`
   - Framework preset: **Other** (не Vite — інакше Vercel буде намагатись розкидати
     rewrites сам)

2. **Vercel Blob store** (для attachments)
   - У Vercel dashboard → Storage → Create → Blob
   - Прив'язати до проєкту `kitchen-os`
   - Vercel сам додасть `BLOB_READ_WRITE_TOKEN` у Environment Variables

3. **Environment Variables** у Vercel dashboard (Settings → Environment Variables):
   - `PG_URL` — Neon production pooled URL
   - `ANTHROPIC_API_KEY` або `OPENROUTER_API_KEY`
   - `APP_URL` — `https://your-vercel-domain.vercel.app` (або custom)
   - `MODEL_FAST`, `MODEL_SMART` — опційно
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` — коли додаси
     прод-мейлер. Без них magic-link друкується в Vercel Function logs.

4. **Build & install settings** у Vercel dashboard:
   - Install Command: `pnpm install`
   - Build Command: залишити default — `vercel.json` вже задає
     `pnpm --filter @kitchen/web build`
   - Output Directory: залишити default — `vercel.json` задає `apps/web/dist`
   - Framework Preset: **Other**

## Прогнати міграції на прод-Neon

Це не робиться автоматично на деплої — вручну з локальної машини перед першим
prod deploy (і після будь-якої нової міграції):

```bash
# Тимчасово вкажемо PG_URL на прод (або читаємо з .env)
PG_URL="postgresql://…neon.tech/neondb…" pnpm --filter @kitchen/db migrate
```

Раннер ідемпотентний — вже застосовані міграції пропускаються.

## Деплой

```bash
# Preview (кожна гілка окремий URL)
vercel

# Prod
vercel --prod
```

## Що перевірити після першого деплою

1. `curl https://<host>/health` → `{"ok": true, "prompt": "…"}`
2. Відкрити `/` в браузері → SignIn екран рендериться
3. Ввести email → знайти magic-link у Vercel Function logs → відкрити → залоглатись
4. Створити тестовий рецепт, додати фото → фото рендериться в Journal
5. Share → скопіювати `/r/…` URL, відкрити в іншому браузері → рецепт видно read-only
6. Той самий URL вставити в Telegram → preview show title + description (це OG-теги
   з `api/index.ts`)

## Порядок cold start

Vercel Function на cold start робить:
1. Load `.env` через `services/api/src/env.ts` (~0ms — просто env vars з dashboard)
2. `new PostgresRepo(pool)` — pool ledger init (~50ms)
3. `migrate()` перевіряє applied migrations (~100ms на Neon)
4. `buildApp()` — реєстрація fastify маршрутів (~50ms)
5. `app.ready()` — валідація schemas (~10ms)

Загалом cold start ~800ms. Warm ~5ms. Не блокер для UX.

## Debug коли щось не працює

- **500 на всі API запити** → чи є `PG_URL` в env? Логи функції в Vercel dashboard.
- **Фото не рендериться** → чи є `BLOB_READ_WRITE_TOKEN`? Без нього
  `LocalFSStore` намагається писати на read-only ФС.
- **Cookie не встановлюється** → `NODE_ENV=production` виставляє `secure: true`,
  cookie летить лише через HTTPS. Локально `pnpm start` без `NODE_ENV=production`
  — цього не буде.
- **Magic-link веде не туди** → `APP_URL` env неправильний. Має відповідати
  Vercel-домену (з протоколом і без слеша в кінці).
- **OG-preview порожнє** → `curl -sH "User-Agent: TelegramBot" https://<host>/r/<id>`
  має повертати HTML з `<meta property="og:title">`. Якщо ні — `api/index.ts` не
  рендерить; перевірити, чи URL справді matches `/r/<uuid>`.

## Preview-branch домени й magic-link

Кожен PR отримує свій URL (`kitchen-os-<hash>-<team>.vercel.app`). Magic-link
у пошту йде на `APP_URL`, який задано в Environment Variables. Тому:
- **Preview деплої**: додати `APP_URL` в env `Preview` scope окремо, або
  прочитати `req.headers.host` в `/v1/auth/request` (не зроблено).
- **Prod**: `APP_URL` = prod-домен, все ок.
