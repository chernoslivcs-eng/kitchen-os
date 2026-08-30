-- Рецепти досі народжувались тільки як побічний ефект cook_run: recipe_id
-- зʼявлявся в POST /v1/cook-runs. Не приготував — рецепт зникав назавжди
-- (знахідка QA-6). У прототипі був екран 07 «Рецепти» зі станами
-- ready / near / saved / cooked; сюди він не доїхав.
--
-- saved_at != null означає «людина натиснула "лишити на потім"».
-- Рецепти без saved_at теж лишаються в списку, якщо їх готували — стан
-- «cooked» рахується join-ом на cook_run.

ALTER TABLE recipe
  ADD COLUMN saved_at timestamptz;

CREATE INDEX recipe_owner_saved_idx
  ON recipe(owner_id, saved_at DESC)
  WHERE saved_at IS NOT NULL;
