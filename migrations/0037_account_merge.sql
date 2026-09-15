-- Злиття акаунтів (власник 15.09): Google-акаунт + Telegram-акаунт-дубль.
--
-- auth_challenge.mode — контракт із лендингом «Почати/Увійти» для kind
--   'tg_login': 'start' (дефолт) — /start без акаунта створює його;
--   'login' — не створює, ставить status 'no_account', веб каже «натисни
--   Почати». (IF NOT EXISTS — ту саму колонку може завести гілка лендингу.)
-- auth_challenge.conflict_user_id — «Додати пошту», а пошта вже має акаунт:
--   володіння поштою доведено листом, чужий акаунт записано як підстава
--   для POST /v1/account/merge (15 хв від consumed_at).
-- telegram_link_token.conflict_user_id — те саме для «Підключити Telegram»,
--   коли Telegram уже привʼязаний до іншого акаунта.
ALTER TABLE auth_challenge ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'start';
ALTER TABLE auth_challenge ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE auth_challenge ADD COLUMN IF NOT EXISTS conflict_user_id uuid REFERENCES "user"(id) ON DELETE SET NULL;
ALTER TABLE telegram_link_token ADD COLUMN IF NOT EXISTS conflict_user_id uuid REFERENCES "user"(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS auth_challenge_conflict_idx ON auth_challenge(user_id, consumed_at DESC) WHERE conflict_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS telegram_link_token_conflict_idx ON telegram_link_token(user_id, consumed_at DESC) WHERE conflict_user_id IS NOT NULL;
