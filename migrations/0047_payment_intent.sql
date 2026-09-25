-- Спек біллінгу 2026-09-25 §4: оформлення з лендінга ДО появи акаунта.
--
-- Людина натискає «Оформити» на картці тарифу, дає картку в LiqPay — і лише
-- потім реєструється. Між цими подіями дому ще немає, тож підписку нема до
-- чого привʼязати: стан живе тут, поки `POST /v1/billing/bind` не зʼєднає
-- його з домом після входу.
CREATE TABLE payment_intent (
  order_id uuid PRIMARY KEY,
  plan text NOT NULL CHECK (plan IN ('self','home')),
  state text NOT NULL CHECK (state IN ('pending','subscribed','bound','expired')),
  -- Те саме число, що пішло в LiqPay як subscribe_date_start (§9.1).
  trial_ends_at timestamptz,
  card_mask text,
  household_id uuid REFERENCES household(id) ON DELETE SET NULL,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  bound_at timestamptz
);

-- Крон шукає лише те, що ще може протухнути: привʼязані й протухлі його не цікавлять.
CREATE INDEX payment_intent_expiring_idx ON payment_intent(expires_at) WHERE state IN ('pending','subscribed');
