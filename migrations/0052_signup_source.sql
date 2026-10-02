-- Джерело реєстрації: з якого посилання людина прийшла, коли завела акаунт.
-- Маркетингу потрібна одна відповідь — який канал (LinkedIn, Instagram,
-- реклама, експерт) дає реєстрації й живі кухні; звіт — docs/signup-sources.sql.
--
-- Окрема таблиця, а не колонки на household чи "user":
--   · рядок пишеться ОДИН раз, при створенні акаунта, і більше не міняється
--     (ON CONFLICT DO NOTHING у репозиторії) — на гарячих таблицях це правило
--     довелося б тримати в голові при кожному UPDATE;
--   · у старих акаунтів рядка немає взагалі, і це чесно відрізняє «джерела не
--     знали» від «людина прийшла без мітки» (рядок є, мітки порожні).
--
-- household_id — дім, який НАРОДИВСЯ цією реєстрацією. NULL — людину запросили
-- в чужий дім: її мітки зберігаємо, але джерелом дому вони не є, дім привів
-- той, хто його створив. Тому UNIQUE: в одного дому джерело одне.
--
-- Каскади навмисні з обох боків: видалили акаунт або дім — зник і слід, звідки
-- він прийшов. Злиття акаунтів (mergeAccounts) рядок дубля не переносить: дубль
-- зникає разом зі своїм домом, і рахувати його окремою реєстрацією нема чого.
--
-- У мітках немає персональних даних: лише [a-z0-9_.-] до 64 символів, значення
-- з «@» відкидаються ще на вході (packages/domain/signup-source.ts).
CREATE TABLE signup_source (
  user_id       uuid PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  household_id  uuid UNIQUE REFERENCES household(id) ON DELETE CASCADE,
  via           text NOT NULL CHECK (via IN ('email','google','telegram','invite')),
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_content   text,
  ref           text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Мітки їдуть на challenge від кліку «увійти» до створення акаунта: лінк із
-- листа відкривають в іншому браузері, а /start тисне бот — localStorage
-- лендінгу там недосяжний. Живе стільки ж, скільки сам challenge.
ALTER TABLE auth_challenge ADD COLUMN source jsonb;
