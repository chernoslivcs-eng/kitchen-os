-- Запрошення в дім посиланням. Той самий каркас, що auth_challenge:
--   token_hash — SHA-256(hex), сирий токен лише в листі
--   одноразовість — consumed_at
--   термін життя — 7 днів (довше за 15 хв magic-link: інша аудиторія й побічний контекст)
--   revocable — власник запрошення може скасувати
--
-- Клік лінку може прийти від людини БЕЗ сесії (типовий випадок: нового учасника
-- запрошено на email, який ще не бачив продукт). Тому /v1/invites/accept
-- сам відкриває сесію — це той самий механізм magic-link, тільки scoped до дому.

CREATE TABLE household_invite (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  invited_by     uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  email          text NOT NULL,
  role           text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  token_hash     text NOT NULL UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  consumed_at    timestamptz,           -- одноразовість
  consumed_by    uuid REFERENCES "user"(id) ON DELETE SET NULL,
  revoked_at     timestamptz            -- скасовано автором запрошення
);
CREATE INDEX household_invite_household_created_idx ON household_invite(household_id, created_at DESC);
CREATE INDEX household_invite_email_idx ON household_invite(lower(email));
