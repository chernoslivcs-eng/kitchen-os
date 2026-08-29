# Задача Cowork: полагодити Neon-підключення

Клауд у терміналі не може відкрити console.neon.tech (немає браузера в його оточенні). Це прямо для тебе — маєш браузер і папку проєкту.

## Що треба зробити

Проєкт `kitchen-os` не приймає пароль Neon у `.env`. Мета: щоб `pnpm --filter @kitchen/db migrate` пройшов без `password authentication failed`, і `pnpm --filter @kitchen/api start` міг використати PostgresRepo замість InMemoryRepo.

## Контекст

Папка: `/Users/philip/Work/2026_AI_CREATIVE/KITCHEN_OS/`.

Поточний `.env` містить:
```
PG_URL=postgresql://neondb_owner:<пароль>@ep-gentle-waterfall-zart3k1z-pooler.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require
PG_TEST_URL=postgresql://neondb_owner:<пароль>@ep-round-dream-zau0u584-pooler.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

Юзер уже пробував пароль `npg_d5HBQufMN1eL` — Neon повернув `28P01 password authentication failed for user 'neondb_owner'`.

Одна з двох причин:
1. Юзер скинув пароль у **іншому** Neon-проєкті, не тому, куди дивиться `.env` (endpoint `ep-gentle-waterfall-zart3k1z-pooler`).
2. У проєкті, на який дивиться `.env`, роль тепер називається інакше або її нема.

## Кроки

1. **Відкрий https://console.neon.tech.** Юзер уже залогінений у Chrome, повинно пустити прямо в dashboard.
2. **Знайди проєкт, чий endpoint починається з `ep-gentle-waterfall-zart3k1z`.**
   - Якщо цей проєкт існує — переходь до кроку 3.
   - Якщо ні — юзер працює з іншим проєктом. Знайди його активний проєкт (той, у якому є branches `main` і `dev`), запиши endpoint і рухайся до кроку 3, використовуючи новий endpoint.
3. **Візьми повний connection string для main branch.** Кнопка «Connect» / «Connection Details» у правому верхньому куті проєкту. Обов'язково **pooled** (з `-pooler` в hostname). Скопіюй цілком, це буде щось на кшталт:
   ```
   postgresql://<user>:<pass>@ep-<name>-pooler.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   ```
4. **Візьми той самий connection string для dev branch** (перемикач branch угорі; той самий Connect → скопіюй). Це піде в `PG_TEST_URL`.
5. **Онови `.env`:** заміни `PG_URL` і `PG_TEST_URL` на скопійовані рядки. Не чіпай інші рядки (`OPENROUTER_API_KEY`, `APP_URL`).
6. **Перевір міграцією:**
   ```bash
   pnpm --filter @kitchen/db migrate
   ```
   Має надрукувати `applied: 0001_init.sql, 0002_auth.sql, 0003_token_usage.sql, 0004_household_invite.sql` (або `skipped:` якщо вони вже застосовані на цьому branch).
7. **Перевір `PostgresRepo` контрактні тести:**
   ```bash
   pnpm --filter @kitchen/db test
   ```
   Має бути `8 passed`. Якщо `skipped` — значить `PG_TEST_URL` не задано або не читається.
8. **Перезапусти API з живим Postgres:**
   ```bash
   lsof -ti :3000 -sTCP:LISTEN | xargs -r kill
   sleep 1
   pnpm --filter @kitchen/api start > /tmp/kitchen-api.log 2>&1 &
   ```
   Перевір: `curl -s http://localhost:3000/health` → `{"ok":true, ...}`.
9. **Скажи юзеру, що готово.** У чат, коротко: «Postgres підключено, дані переживають рестарт. Ось лінк:», і згенеруй йому magic-link для входу:
   ```bash
   curl -s -X POST http://localhost:3000/v1/auth/request -H 'Content-Type: application/json' -d '{"email":"chernosliv.cs@gmail.com"}' > /dev/null
   sleep 1
   tail -5 /tmp/kitchen-api.log | tr ' ' '\n' | grep -o 'http://localhost:5173/v1/auth/verify?token=[A-Za-z0-9_-]*' | tail -1
   ```

## Правила

- **Не створюй новий проєкт у Neon.** Якщо активний проєкт вже є з даними (навіть тестовими) — використовуй його, не роби «чистий».
- **Не міняй нічого крім `PG_URL` і `PG_TEST_URL` у `.env`.**
- **Не пуш комітів із паролем у git.** `.env` уже в `.gitignore`, але перевір `git status` перед `git commit` — якщо `.env` раптом трекається, скажи це в чат замість того, щоб пушити.
- **Не роби ресет пароля вдруге,** якщо перший спробуй авторизуватися не вдалось — спершу впевнись, що дивишся на правильний проєкт (пункт 2).

Коли закінчиш, юзер знову у грі й може клацати «Рецепт → Cook Mode» без страху, що дані злетять на рестарті.
