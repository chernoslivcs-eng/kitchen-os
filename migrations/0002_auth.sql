-- Magic-link автентифікація й серверні сесії.
-- Один потік: email → challenge → verify → cookie. Немає паролів,
-- немає OAuth, немає JWT. Простір відмови вужчий, ротація ключів не потрібна.
--
-- Виклик (challenge) — одноразовий токен на 15 хв, під сирою рядковою формою.
-- Сесія (session) — opaque токен, покладений у httpOnly cookie; сервер тримає
-- його як хеш (SHA-256, hex), щоб дамп БД не давав доступ до живих сесій.

CREATE TABLE auth_challenge (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  token_hash    text NOT NULL UNIQUE,           -- SHA-256(hex) від сирого токена
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,                    -- одноразово: другий verify = 410
  ip            inet,                           -- контекст для аудиту, не для перевірки
  user_agent    text
);
CREATE INDEX auth_challenge_email_created_idx ON auth_challenge(email, created_at DESC);
-- Прибрати «мертві» одноразові токени можна періодичним DELETE — це rate-limit-friendly.

CREATE TABLE auth_session (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  cookie_hash   text NOT NULL UNIQUE,           -- SHA-256(hex) від сирого cookie
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,           -- rolling: продовжується на використанні
  revoked_at    timestamptz,
  ip            inet,
  user_agent    text
);
CREATE INDEX auth_session_user_idx ON auth_session(user_id) WHERE revoked_at IS NULL;
