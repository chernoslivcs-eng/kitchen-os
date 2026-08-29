# Чек-лист деплою на Vercel

Складено з перевірки репо на коміті `564ce65` (`Vercel deploy scaffold`).
Код я не чіпав — усі правки нижче з готовими дифами, робить їх той, хто вже в цих файлах.

Джерела фактів про Vercel — [ліміти функцій](https://vercel.com/docs/functions/limitations)
і [includeFiles](https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions),
станом на 24.08.2026.

---

## Що вже перевірено і працює

| Перевірка | Результат |
|---|---|
| `pnpm --filter @kitchen/web build` | ✅ 82 модулі, 356 КБ (97 КБ gzip) |
| `pnpm -r typecheck` (7 пакетів) | ✅ чисто |
| `tsc --noEmit -p api/tsconfig.json` | ✅ чисто |
| `server.ts` не піднімає `listen()` при імпорті | ✅ guard `import.meta.url === file://${argv[1]}` на місці |
| `VercelBlobStore` + вибір за `BLOB_READ_WRITE_TOKEN` | ✅ написаний, `pickStore()` перемикає |
| Cookie `secure` у проді | ✅ через `isSecure()`, Vercel сам ставить `NODE_ENV=production` |
| Rewrites у `vercel.json` | ✅ статика віддається до rewrites, `/v1/*` і `/r/:id` йдуть у функцію |

---

## Блокери — впаде на першому запиті

### 1. Міграції читаються з диска в рантаймі

`packages/db/migrate.ts`:

```ts
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = resolve(HERE, '../../migrations');
...
const files = readdirSync(dir)
```

У бандлі функції теки `migrations/` не буде: трасувальник Vercel не бачить
обчислених шляхів, а документація прямо каже не покладатись на `__dirname`.
`buildAppWithBackend()` викликає `migrate()` **до** створення репо, тож ENOENT
кладе не міграцію, а весь API.

**Рекомендований фікс — винести міграцію в крок білду.** Заодно знімає гонку
(див. проблему 5): білд виконується раз на деплой, а не на кожному cold start.

`vercel.json`:
```diff
-  "buildCommand": "pnpm --filter @kitchen/web build",
+  "buildCommand": "pnpm --filter @kitchen/db migrate && pnpm --filter @kitchen/web build",
```

`services/api/src/server.ts`, у `buildAppWithBackend()`:
```diff
   if (url) {
     const pool = makePool(url);
-    const migRes = await migrate(pool);
-    if (migRes.applied.length) console.log('migrations applied:', migRes.applied.join(', '));
+    // На Vercel міграції ганяє крок білду (buildCommand): у бандлі функції теки
+    // migrations/ немає, і паралельні cold start'и влаштували б гонку.
+    if (!process.env.VERCEL) {
+      const migRes = await migrate(pool);
+      if (migRes.applied.length) console.log('migrations applied:', migRes.applied.join(', '));
+    }
     repo = new PostgresRepo(pool);
```

Для цього `PG_URL` має бути доступний на build-time — у Vercel env-змінні
видно і білду, і рантайму, тож достатньо просто додати її в dashboard.

### 2. `index.html` для OG-тегів читається з диска функції

`api/index.ts`, `readIndexHtml()` бере `process.cwd()/apps/web/dist/index.html`.
Фронтенд-білд іде в статику, у бандл функції він не потрапляє → `/r/:id`
віддасть 500 замість прев'ю в Telegram, тобто рівно те, заради чого файл писався.

`process.cwd()` тут правильний (документація саме його й радить) — бракує лише
рядка конфігу:

```diff
   "functions": {
     "api/index.ts": {
-      "maxDuration": 30,
-      "memory": 1024
+      "maxDuration": 120,
+      "memory": 1024,
+      "includeFiles": "apps/web/dist/index.html"
     }
   },
```

`maxDuration` заодно піднято: платформа дозволяє 300 с на Hobby і до 800 с на Pro,
а 30 с може не вистачити на генерацію рецепта Anthropic'ом. Гроші рахуються за
активний CPU, а не за очікування мережі, тож запас нічого не коштує.

---

## Проблеми в проді — задеплоїться, але зламається

### 3. `APP_URL` веде на localhost

`services/api/src/routes/auth.ts:26` і `invites.ts:23`:
```ts
return process.env.APP_URL ?? 'http://localhost:3000';
```

Magic-link у листах і лінк запрошення в дім поведуть у нікуди. Це впаде обличчям
на першому ж вході. Виставити в Vercel Env на прод-домен, без слеша в кінці.

### 4. Фото більші за 4.5 МБ не завантажаться

Ліміт тіла запиту у Vercel — **4.5 МБ**, повертає 413 `FUNCTION_PAYLOAD_TOO_LARGE`.
`services/api/src/server.ts:44` ставить `fileSize: 20 * 1024 * 1024` — цей ліміт
не спрацює ніколи, платформа обірве раніше. Фото полиці з телефона — типово 3–8 МБ.

Два шляхи:
- **швидкий**: ресайз на клієнті перед відправкою (canvas, довша сторона ~1600 px,
  jpeg q=0.8 — для розпізнавання полиці цього більш ніж досить);
- **правильний**: client upload напряму в Blob через `handleUpload` із
  `@vercel/blob/client`, тіло запиту тоді взагалі не йде через функцію.

Мінімум — зловити 413 і сказати людині «фото завелике», а не віддавати їй
голу помилку платформи.

### 5. Гонка міграцій на cold start

Знімається фіксом 1. Якщо міграція все ж лишається в рантаймі — два інстанси,
що стартують одночасно на свіжій базі, підуть у `CREATE TABLE` разом. Тоді
потрібен `pg_advisory_lock` на тому самому клієнті, що виконує міграції.

### 6. Rate limiter живе в памʼяті інстансу

`services/api/src/rate-limit.ts` — `new Map()` у замиканні. На N інстансах ліміт
5 спроб / 15 хв на `/v1/auth/request` стає 5×N. Саме той бар'єр, який мав тримати
перебір magic-link, розсипається рівно тоді, коли навантаження зросте.

Коментар у файлі це передбачає («для кластерного деплою треба спільна база»).
Postgres уже є — бакети можна класти туди тим самим інтерфейсом `RateLimiter`,
жодного роуту не чіпаючи. Окрема задача, не блокер запуску.

### 7. `pg.Pool` з `max: 10` на кожен інстанс

`packages/db/pool.ts:6`. Для serverless канон — 1–2 конекшени на інстанс,
пулінг робить Neon. Плюс у Vercel є ліміт 1024 файлових дескрипторів на функцію,
спільний для всіх одночасних викликів.

```diff
-  const pool = new pg.Pool({ connectionString, max: 10 });
+  const max = Number(process.env.PG_POOL_MAX ?? (process.env.VERCEL ? 2 : 10));
+  const pool = new pg.Pool({ connectionString, max });
```

### 8. `CACHE_VERSION` у service worker бампається руками

`apps/web/public/sw.js:8` — `kitchen-os-v1`, кешує `/index.html` під цим ключем.
Vite хешує assets, а `index.html` — ні. Після деплою встановлений PWA
показуватиме стару збірку, поки версію не змінять. Або бампати в кожному релізі,
або зшивати версію з build-часу (`__BUILD_ID__` через `define` у vite.config).

---

## Env-змінні у Vercel dashboard

`.env` у гіті немає і не має бути. Усе нижче — руками в Project Settings → Environment Variables.

| Змінна | Значення | Навіщо |
|---|---|---|
| `PG_URL` | pooled Neon connection string (з `-pooler` у хості) | без неї API мовчки піде на `InMemoryRepo` і дані злетять на кожному cold start |
| `ANTHROPIC_API_KEY` | ключ | без нього модель у стабі |
| `APP_URL` | `https://<прод-домен>` | лінки в листах, див. проблему 3 |
| `BLOB_READ_WRITE_TOKEN` | з Vercel → Storage → Blob | без нього `pickStore()` дасть `LocalFSStore`, а ФС на Vercel read-only → перше ж фото 500 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Resend або SES | без `SMTP_HOST` пошта йде в stdout — magic-link ніхто не отримає |
| `MAIL_FROM` | `Кухня <no-reply@домен>` | |
| `PG_POOL_MAX` | `2` | якщо взяти фікс 7 через env |
| `MODEL_FAST` / `MODEL_SMART` | опційно | дефолти в `packages/model-client/profiles.ts` |

`NODE_ENV` **не додавати** — Vercel виставляє сам, ручне значення перекриє дефолт
і зламає `secure` на cookie.

---

## Каталог не в `main`

`catalog/expand` містить main (є merge-коміт `0b9f017`), зворотного мержу не було:

```
$ git show main:packages/catalog/seed.ts | grep -c "key: "
131
```

Задеплоїш `main` — у проді поїде каталог на 131 позицію замість 2341, і разом із
ним стара логіка резолвера без `priority`. Мержити до деплою.

---

## Порядок

1. Влити `catalog/expand` у `main`.
2. Фікси 1 і 2 (блокери) + 3 і 7 (однорядкові).
3. Завести env-змінні в dashboard.
4. Перший деплой у preview, не в prod. Перевірити на preview-URL:
   `/health` → `{"ok":true}`; вхід через magic-link доходить листом;
   `/r/<uuid>` віддає OG-теги (`curl -s <url>/r/... | grep og:title`);
   завантаження фото ~2 МБ проходить.
5. Фікс 4 (ресайз на клієнті) — до того, як хтось спробує фото з телефона.
6. Фікси 6 і 8 — окремими задачами після запуску.
