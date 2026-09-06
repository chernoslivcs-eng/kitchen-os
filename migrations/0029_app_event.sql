-- Крок О1а: своя таблиця подій.
--
-- Зовнішній інструмент не брали свідомо: обсяг мізерний (одна людина ≈ 50
-- подій на день), схема специфічна для продукту, а дані чутливі — розпорядок
-- дня і склад холодильника конкретної людини хай лишаються тут.
--
-- Сюди ж, поки немає Sentry (він буде О1б), пишуться серверні інциденти під
-- імʼям `incident:<назва>`. Коли Sentry зʼявиться, той самий хелпер почне
-- дублювати туди, а ця таблиця лишиться як локальна історія.
--
-- props — тільки СТРУКТУРНЕ: номер кроку, назва зрізу, рід вкладення. Назв
-- продуктів і вмісту комори тут не буває.

CREATE TABLE app_event (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- Дім може бути невідомий (подія до вибору дому) — тому без NOT NULL.
  household_id  uuid REFERENCES household(id) ON DELETE CASCADE,
  name          text NOT NULL,
  props         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Головний (і поки єдиний) шлях читання — «що робила ця людина того дня»,
-- від найсвіжішого.
CREATE INDEX app_event_user_time_idx ON app_event (user_id, created_at DESC);
