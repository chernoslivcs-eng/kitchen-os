-- Їдці дому без акаунтів: «зі мною живе Оксана, вона веганка».
-- Не user і не household_member — вони не логіняться й не пишуть у комору,
-- вони просто їдять те, що тут готують. До цього промпт радив розмазувати
-- людину по анти-полю власника рядком «на двох: Оксана не їсть мʼяса».
CREATE TABLE eater (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name          text NOT NULL,
  allergies     text[] NOT NULL DEFAULT '{}',
  wishes        text[] NOT NULL DEFAULT '{}',
  antipatterns  text[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX eater_household_idx ON eater(household_id, created_at);
