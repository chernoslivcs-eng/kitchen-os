-- 0001_init: базові таблиці за 02-architecture.html.
-- Ідея: household — головна одиниця власності. Спільне: комора, обладнання, список, календар.
-- Особисте: профіль, досвід, журнал, сесії, задуми. Сесії не шеряться НІКОЛИ.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ----- Люди й доми --------------------------------------------------------

CREATE TABLE "user" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text UNIQUE NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE household (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE household_member (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('owner','member')),
  joined_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, user_id)
);
CREATE INDEX household_member_user_idx ON household_member(user_id);

-- Профіль — особистий, 1:1 з користувачем.
-- Три блоки: allergies (конкретні назви), wishes (вільні фрази), antipatterns (вільні фрази).
-- Дієта, релігія, календар — не окремі поля, а фрази в wishes/antipatterns.
CREATE TABLE profile (
  user_id       uuid PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  allergies     text[]  NOT NULL DEFAULT '{}',
  wishes        text[]  NOT NULL DEFAULT '{}',
  antipatterns  text[]  NOT NULL DEFAULT '{}',
  equipment     jsonb   NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ----- Каталог ------------------------------------------------------------

-- Дубль DDL із packages/catalog/schema.sql — тримається тут як канонічне джерело
-- для міграції. packages/catalog/schema.sql лишається довідковим (для локальних
-- прогонів тестів каталогу), але порядок застосування в проді — цей файл.
CREATE TABLE catalog_ingredient (
  key             text PRIMARY KEY,
  name            text NOT NULL,
  aliases         text[] NOT NULL DEFAULT '{}',
  categories      text[] NOT NULL DEFAULT '{}',
  allergen_groups text[] NOT NULL DEFAULT '{}',
  zone_default    text NOT NULL CHECK (zone_default IN ('dry','fridge','freezer','fresh','spices','drinks')),
  unit_weight     numeric,
  density         numeric,
  nutrition       jsonb
);
CREATE INDEX catalog_ingredient_name_trgm_idx ON catalog_ingredient USING gin (name gin_trgm_ops);
CREATE INDEX catalog_ingredient_aliases_idx   ON catalog_ingredient USING gin (aliases);
CREATE INDEX catalog_ingredient_categories_idx ON catalog_ingredient USING gin (categories);
CREATE INDEX catalog_ingredient_allergen_groups_idx ON catalog_ingredient USING gin (allergen_groups);

-- ----- Комора -------------------------------------------------------------

-- Партія, НЕ продукт. Ймовірнісна: confidence і provenance у кожної.
CREATE TABLE pantry_batch (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id              uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  catalog_key               text REFERENCES catalog_ingredient(key),  -- null, поки не впізнали
  label                     text NOT NULL,                            -- як показувати людині
  zone                      text NOT NULL CHECK (zone IN ('dry','fridge','freezer','fresh','spices','drinks')),
  value                     numeric,
  unit                      text CHECK (unit IN ('g','ml','pcs','pack')),
  state                     text NOT NULL DEFAULT 'sealed' CHECK (state IN ('sealed','opened','depleted')),
  opened_at                 timestamptz,
  expires_at                timestamptz,
  best_before_opened_days   int,
  added_at                  timestamptz NOT NULL DEFAULT now(),
  depleted_at               timestamptz,                              -- лишається 7 днів у кошику
  confidence                numeric NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  provenance                text NOT NULL CHECK (provenance IN ('receipt_line','package_label','user_statement','visual_guess','inference')),
  staple                    boolean NOT NULL DEFAULT false,
  last_by                   uuid REFERENCES "user"(id) ON DELETE SET NULL,
  last_action               text
);
-- Читається в КОЖНОМУ промпті — індекс критичний.
CREATE INDEX pantry_batch_household_state_idx ON pantry_batch(household_id, state);
CREATE INDEX pantry_batch_label_trgm_idx ON pantry_batch USING gin (label gin_trgm_ops);

-- ----- Список покупок -----------------------------------------------------

CREATE TABLE shopping_item (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  label         text NOT NULL,
  reason        text,
  value         numeric,
  unit          text,
  zone          text,
  checked       boolean NOT NULL DEFAULT false,
  added_by      uuid REFERENCES "user"(id) ON DELETE SET NULL,
  source        text NOT NULL CHECK (source IN ('user','recipe','model','retail')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shopping_item_household_idx ON shopping_item(household_id, checked);

-- ----- Рецепти й приготування --------------------------------------------

-- Рецепт — заморожений знімок. `payload` тримає ing/steps як є з моделі.
CREATE TABLE recipe (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  origin         text NOT NULL CHECK (origin IN ('generated','imported','catalog')),
  title          text NOT NULL,
  descr          text,
  character      text,
  risk           text,
  base_servings  int NOT NULL DEFAULT 2,
  time_total     int,
  nutrition      jsonb,
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recipe_owner_idx ON recipe(owner_id, created_at DESC);

CREATE TABLE cook_run (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  recipe_id     uuid NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  servings      int NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  rating        int CHECK (rating BETWEEN 1 AND 5),
  verdict       text,
  photo_url     text
);
CREATE INDEX cook_run_user_finished_idx ON cook_run(user_id, finished_at DESC);

CREATE TABLE memory_note (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  text           text NOT NULL,
  recipe_title   text,
  rating         int CHECK (rating BETWEEN 1 AND 5),
  pinned         boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memory_note_user_idx ON memory_note(user_id, pinned DESC, created_at DESC);

-- ----- Сесії й повідомлення ----------------------------------------------

-- Сесія — розмова на день. Не шериться ніколи.
CREATE TABLE session (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title       text,
  day         date NOT NULL DEFAULT current_date,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_user_day_idx ON session(user_id, day DESC);

-- Повідомлення. `card` — те, що модель повернула (пропозиція).
-- `applied` — скільки ops із картки фактично застосовано (для правила «модель не пише в стан напряму»).
CREATE TABLE message (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('user','assistant')),
  text        text,
  card        jsonb,
  applied     int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_session_created_idx ON message(session_id, created_at);

-- Вкладення — окремо від message.card, бо фото — це мегабайти в обʼєктному сховищі.
-- Створюється до message (клієнт заливає файл, потім шле /v1/chat). message_id
-- проставляється, коли зʼявиться потік сесій.
CREATE TABLE attachment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    uuid,                                  -- FK на message додамо, коли зʼявиться потік сесій
  household_id  uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('image','pdf','text')),
  url           text NOT NULL,                         -- посилання в обʼєктному сховищі (fs:// або s3://)
  content_type  text,
  bytes         int,
  hint          text,                                  -- уточнення для «розібрати ще раз»
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachment_message_idx ON attachment(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX attachment_household_idx ON attachment(household_id, created_at DESC);

-- ----- Історія споживання -------------------------------------------------

-- Лічильник для передбачення покупок.
CREATE TABLE consumption (
  household_id      uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  catalog_key       text NOT NULL REFERENCES catalog_ingredient(key),
  times             int NOT NULL DEFAULT 0,
  last_depleted_at  timestamptz,
  PRIMARY KEY (household_id, catalog_key)
);

-- ----- Картки на застосуванні (idempotency + undo) ------------------------

-- Розділення `/chat` і `/apply` вимагає стану між ними: щоб apply був ідемпотентним
-- і мав токен скасування. Не lock на message.card, бо картка з попереднього дня
-- лишається клікабельною, і повторний apply — це no-op, не помилка.
CREATE TABLE card_pending (
  id              uuid PRIMARY KEY,                                      -- дорівнює message.id
  message_id      uuid NOT NULL,                                         -- FK на message додамо, коли зʼявиться потік сесій
  household_id    uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  card            jsonb NOT NULL,                                        -- знімок картки на момент віддачі
  applied_at      timestamptz,                                           -- null = ще не застосовано
  applied_ops     jsonb,                                                 -- індекси застосованих ops
  undo_token      uuid,
  undo_snapshot   jsonb,                                                 -- зворотні операції: попередній стан партій
  undone_at       timestamptz
);
CREATE INDEX card_pending_message_idx ON card_pending(message_id);
