-- M13 (retail/silpo): підключення користувача до мережі. Токени лежать
-- ТІЛЬКИ шифротекстом (AES-GCM в API-шарі, ключ у env) — вимога документації
-- Сільпо «токен не тримати в публічному фронтенді» тут посилена до «БД не
-- бачить plaintext». status='disconnected' — мʼяке відключення з тостом
-- «Повернути ↩»: рядок живе, undo вертає 'active' без нового OAuth.

CREATE TABLE retail_connection (
  id                uuid PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider          text NOT NULL,           -- 'silpo' перший, не єдиний
  access_token_enc  text NOT NULL,
  refresh_token_enc text,
  expires_at        timestamptz NOT NULL,
  status            text NOT NULL DEFAULT 'active',  -- active | disconnected
  connected_at      timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  last_receipt_at   timestamptz            -- водяний знак синку чеків (ідемпотентність)
);

-- Одне підключення на пару користувач+мережа; refresh — перезапис, не другий рядок.
CREATE UNIQUE INDEX retail_connection_user_provider_uq
  ON retail_connection (user_id, provider);
