-- Спек 2026-09-25-lapsed-subscription-design.md §6: підписка належить ДОМУ,
-- не людині — один рядок на дім, стан бачать усі члени, платити й скасовувати
-- може будь-хто з них.
--
-- Поле "user".plan (міграція 0024) лишається на місці: цим етапом його лише
-- перестають читати як джерело правди про доступ.
CREATE TABLE household_subscription (
  household_id uuid PRIMARY KEY REFERENCES household(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('beta','trial','active','cancelled','past_due','lapsed')),
  plan text CHECK (plan IN ('self','home')),
  trial_used_at timestamptz,
  trial_ends_at timestamptz,
  next_charge_at timestamptz,
  access_until timestamptz,
  provider_order_id text UNIQUE,
  card_mask text,
  paid_by_user_id uuid REFERENCES "user"(id) ON DELETE SET NULL,
  deletion_warned_at timestamptz,
  -- Лист «за 3 дні до кінця пробного» надіслано: крон ідемпотентний.
  trial_mail_sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Бухгалтерський слід ФОП (спек §5: зберігаємо 3 роки). Карток тут немає —
-- лише сума, дата, статус і id платежу в провайдера.
CREATE TABLE payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'UAH',
  status text NOT NULL CHECK (status IN ('success','failure')),
  -- UNIQUE — саме те, чим тримається ідемпотентність вебхука (спек §7):
  -- LiqPay присилає те саме двічі, другий INSERT мовчки не проходить.
  provider_payment_id text UNIQUE,
  paid_by_user_id uuid REFERENCES "user"(id) ON DELETE SET NULL,
  receipt_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_household_idx ON payment(household_id, created_at DESC);

-- Крон шукає доми по стану: «кого сьогодні переводити в lapsed», «кому слати
-- лист про кінець пробного», «хто тихий пів року».
CREATE INDEX household_subscription_state_idx ON household_subscription(state);
