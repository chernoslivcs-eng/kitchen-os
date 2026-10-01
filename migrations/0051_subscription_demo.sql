-- Демо замість бети (спек 2026-10-01-demo-instead-of-beta-design.md §2).
--
-- Кожен дім отримує 7 днів повного доступу без картки. Це окремий стан, а не
-- `trial` з нульовою ціною: пробний у нас означає «картка вже привʼязана, у
-- дату X спишеться», і плутати їх означало б обіцяти людині списання, якого
-- ніхто не замовляв.
--
-- `beta` у переліку лишається: старі рядки мусять читатися й після того, як
-- стан перестав набуватись. Прибирати його можна тільки окремою міграцією,
-- яка спершу переведе всі такі рядки.
ALTER TABLE household_subscription ADD COLUMN IF NOT EXISTS demo_ends_at timestamptz;
-- Лист «за 2 дні до кінця демо» надіслано. Окреме поле, не trial_mail_sent_at:
-- демо-дім пробного вже не отримає, і чужий слід у його рядку лише збивав би.
ALTER TABLE household_subscription ADD COLUMN IF NOT EXISTS demo_mail_sent_at timestamptz;

ALTER TABLE household_subscription DROP CONSTRAINT IF EXISTS household_subscription_state_check;
ALTER TABLE household_subscription ADD CONSTRAINT household_subscription_state_check
  CHECK (state IN ('beta','demo','trial','active','cancelled','past_due','lapsed'));
