-- Облік токенів. Пишемо один рядок на кожен виклик моделі — включно зі стабом
-- (mode='stub', input=output=0), щоб у тестовому середовищі теж було видно
-- проходження виклику. У проді фільтруємо по mode='live'.
--
-- Це те, чого не було в прототипі й що 04-roadmap.html називає незворотним боргом:
-- «потім не відновити заднім числом». Тому рядок пишемо навіть коли модель повернула
-- порожню відповідь — сам факт виклику вартує.

CREATE TABLE token_usage (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  household_id    uuid REFERENCES household(id) ON DELETE SET NULL,
  call            text NOT NULL,     -- 'chat' | 'attachment_parse' | 'recipe_gen' | 'recipe_import' | 'pantry_search'
  profile         text NOT NULL,     -- 'fast' | 'smart' | 'stub'
  model           text NOT NULL,     -- exact model id (or 'stub')
  prompt_version  text NOT NULL,
  mode            text NOT NULL CHECK (mode IN ('live','stub')),
  input_tokens    int NOT NULL DEFAULT 0,
  output_tokens   int NOT NULL DEFAULT 0,
  cached_tokens   int NOT NULL DEFAULT 0,
  latency_ms      int,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Індекси під два основні запити: рахунок для конкретного юзера і для дому.
CREATE INDEX token_usage_user_created_idx ON token_usage(user_id, created_at DESC);
CREATE INDEX token_usage_household_created_idx ON token_usage(household_id, created_at DESC) WHERE household_id IS NOT NULL;
