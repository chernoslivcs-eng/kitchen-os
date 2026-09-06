-- Раунд 5, крок П1: періоди з правилом.
--
-- Дві сутності, не одна. Довідник (occasion_catalog) спільний і не редагується
-- домом; те, що дім бачить, вирішує ПІДПИСКА: сезон і редакційне увімкнені,
-- поки не відписались, свято традиції вимкнене, поки не підписались. Рядок
-- підписки існує лише як відхилення від цього дефолту — «ми католики» стає
-- батчем рядків enabled=true на всі приводи tradition='catholic'.
--
-- Традиція як поле користувача ("user".traditions, крок 11) і особисте
-- «не показувати» (user_occasion_mute, 0019) зникають: обидва — часткові
-- форми тієї самої підписки. Ключ домовий: календар підписок спільний для
-- дому, як комора і список.

CREATE TABLE occasion_subscription (
  household_id uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  occasion_id  text NOT NULL,            -- occasion_catalog.id
  enabled      boolean NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, occasion_id)
);

-- Світські українські свята — окремий набір традиції.
ALTER TABLE occasion_catalog DROP CONSTRAINT IF EXISTS occasion_catalog_tradition_check;
ALTER TABLE occasion_catalog ADD CONSTRAINT occasion_catalog_tradition_check
  CHECK (tradition IN ('orthodox', 'catholic', 'islamic', 'jewish', 'secular'));

-- Перенос: обрані традиції → підписка дому на кожен привід цієї традиції
-- (і на Великдень без традиції — для православних і католиків).
INSERT INTO occasion_subscription (household_id, occasion_id, enabled)
SELECT DISTINCT hm.household_id, oc.id, true
  FROM "user" u
  JOIN household_member hm ON hm.user_id = u.id
  JOIN occasion_catalog oc ON oc.kind = 'tradition'
   AND (oc.tradition = ANY(u.traditions)
        OR (oc.tradition IS NULL AND (u.traditions && ARRAY['orthodox', 'catholic'])))
 WHERE u.traditions IS NOT NULL
ON CONFLICT DO NOTHING;

-- Перенос: особисте «не показувати» → відписка дому.
INSERT INTO occasion_subscription (household_id, occasion_id, enabled)
SELECT DISTINCT hm.household_id, m.occasion_id, false
  FROM user_occasion_mute m
  JOIN household_member hm ON hm.user_id = m.user_id
ON CONFLICT DO NOTHING;

DROP TABLE user_occasion_mute;
ALTER TABLE "user" DROP COLUMN traditions;

-- Записи дому: дієта на період, дати явно, правило дослівно, «суворо».
ALTER TABLE household_event DROP CONSTRAINT household_event_kind_check;
ALTER TABLE household_event ADD CONSTRAINT household_event_kind_check
  CHECK (kind IN ('meal', 'supply', 'constraint', 'custom', 'diet'));
ALTER TABLE household_event
  ADD COLUMN date_from date,
  ADD COLUMN date_to   date,
  ADD COLUMN rule_text text,
  ADD COLUMN strict    boolean NOT NULL DEFAULT false;
-- strict ↔ force='restrict': один факт, два читачі (двигун дат і людина).
UPDATE household_event SET strict = (force = 'restrict');
-- Дати з разових правил — щоб from/to не були порожні для старих рядків.
UPDATE household_event
   SET date_from = (rule->>'at')::date,
       date_to   = (rule->>'at')::date + GREATEST(1, COALESCE((rule->>'days')::int, 1)) - 1
 WHERE rule->>'t' = 'once';
-- Джерело: картка моделі тепер «chat».
ALTER TABLE household_event DROP CONSTRAINT household_event_source_check;
UPDATE household_event SET source = 'chat' WHERE source = 'model';
ALTER TABLE household_event ADD CONSTRAINT household_event_source_check
  CHECK (source IN ('user', 'chat'));
