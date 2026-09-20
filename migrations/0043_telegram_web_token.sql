-- E (20.09): лінк «Відкрити у вебі» з бота — один живий токен на акаунт,
-- 24 год, багаторазовий (замість auth_challenge kind 'telegram' на 15 хв
-- разово: Telegram iOS відкриває лінки у вбудованому браузері з окремими
-- куками, і кожен тап був новим входом). Лише хеш: сирий токен виводиться
-- з id серверним секретом (packages/domain/telegram-web-token.ts).
-- 0041 — digest (#161), 0042 — intake_streak (#168).
CREATE TABLE telegram_web_token (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX telegram_web_token_live ON telegram_web_token (user_id) WHERE revoked_at IS NULL;
