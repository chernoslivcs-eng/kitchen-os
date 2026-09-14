-- TELEGRAM-AUTH-PAY-PLAN-0915, PR 1: акаунт із Telegram-id без пошти.
--
-- "user".email стає nullable: людина, що прийшла з бота або з віджета
-- Telegram, пошти не має, доки не додасть її сама. Унікальність лишається,
-- але часткова — лише для непорожніх адрес (кілька NULL — не конфлікт).
-- Джерело істини для Telegram — telegram_account (дзеркала в user нема,
-- рішення виконавця: один індекс telegram_account.telegram_user_id уже є PK).
-- telegram_account.chat_id стає nullable: вхід із віджета на лендингу знає
-- telegram_user_id, але не chat_id — той заповниться при першому /start.
ALTER TABLE "user" ALTER COLUMN email DROP NOT NULL;
ALTER TABLE "user" DROP CONSTRAINT IF EXISTS user_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS user_email_unique ON "user" (email) WHERE email IS NOT NULL;
ALTER TABLE telegram_account ALTER COLUMN chat_id DROP NOT NULL;

-- Одноразовий вхід у веб із бота (PR 2): той самий auth_challenge, але без
-- пошти — kind 'telegram' і user_id, чию сесію відкрити. Магік-лінк лишається
-- kind 'email' з поштою.
ALTER TABLE auth_challenge ALTER COLUMN email DROP NOT NULL;
ALTER TABLE auth_challenge ADD COLUMN kind text NOT NULL DEFAULT 'email';
ALTER TABLE auth_challenge ADD COLUMN user_id uuid REFERENCES "user"(id) ON DELETE CASCADE;
