-- Каталог інгредієнтів. Від нього залежать 4 різні механізми:
-- алергени за змістом, релігійні обмеження, синоніми в резолвері, морфологія в пошуку.
-- Без нього кожен лікується окремою милицею.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE IF NOT EXISTS catalog_ingredient (
  key             text PRIMARY KEY,
  name            text NOT NULL,                    -- канонічна назва для людини
  aliases         text[] NOT NULL DEFAULT '{}',     -- як зустрічається в чеках і мовленні
  categories      text[] NOT NULL DEFAULT '{}',     -- ієрархія: мідії → молюски → морепродукти → тваринне
  allergen_groups text[] NOT NULL DEFAULT '{}',     -- «молюски», «ракоподібні», «горіхи», «глютен» ...
  zone_default    text NOT NULL CHECK (zone_default IN ('dry','fridge','freezer','fresh','spices','drinks')),
  unit_weight     numeric,                          -- вага «однієї штуки», якщо продукт рахується поштучно
  density         numeric,                          -- g/ml для конверсій між масою й обʼємом
  nutrition       jsonb                             -- {"kcal":540,"p":28,"f":22,"c":55} на 100 г
);

-- Індекси, які знадобляться одразу:

-- 1) Швидкий пошук за назвою й аліасами (для резолвера й запитів «знайди»).
CREATE INDEX IF NOT EXISTS catalog_ingredient_name_trgm_idx
  ON catalog_ingredient USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_ingredient_aliases_trgm_idx
  ON catalog_ingredient USING gin (aliases);

-- 2) Пошук за категорією (для антипатернів на кшталт «не їм свинину»).
CREATE INDEX IF NOT EXISTS catalog_ingredient_categories_idx
  ON catalog_ingredient USING gin (categories);

-- 3) Пошук за алергенною групою (для позначок алергії).
CREATE INDEX IF NOT EXISTS catalog_ingredient_allergen_groups_idx
  ON catalog_ingredient USING gin (allergen_groups);
