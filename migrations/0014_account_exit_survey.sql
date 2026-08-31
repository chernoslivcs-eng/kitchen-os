-- Пул-5 №1: видалення акаунта з опитувальником. Відповідь має пережити
-- самого юзера (той видаляється з каскадами), тому окрема таблиця без FK.
CREATE TABLE account_exit_survey (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  reason      text NOT NULL,          -- код причини: unused|hard|privacy|other
  comment     text,                   -- вільний текст за бажанням
  created_at  timestamptz NOT NULL DEFAULT now()
);
