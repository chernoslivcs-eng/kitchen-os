-- Р147 (TELEGRAM-PLAN-0913, PR 1): Telegram як другий канал у чат дому.
--
-- telegram_account — привʼязка Telegram-користувача до людини Kitchen OS.
--   Ключ — telegram_user_id (один Telegram → одна людина); chat_id — куди
--   боту писати; revoked_at — /stop: рядок лишається (історія, повторне
--   /start його оживляє), але писати в дім більше не можна.
-- telegram_link_token — разовий токен із профілю: «Підключити» → t.me/<bot>?start=<token>
--   → бот міняє токен на привʼязку. 15 хвилин, consumed_at — щоб токен не
--   спрацював двічі.
-- message.channel — звідки прийшов хід: 'web' (усе, що було) або 'telegram';
--   веб показує другий міткою «з Telegram» у мета-рядку.
CREATE TABLE telegram_account (
  telegram_user_id bigint PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  chat_id          bigint NOT NULL,
  linked_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz
);
CREATE INDEX telegram_account_user_idx ON telegram_account (user_id);

CREATE TABLE telegram_link_token (
  token       text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz
);

ALTER TABLE message ADD COLUMN channel text NOT NULL DEFAULT 'web';
