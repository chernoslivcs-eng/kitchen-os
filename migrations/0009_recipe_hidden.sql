-- QA9-08: «можливості видалити старі рецепти — нема». Рядок «готував, не
-- зберіг» неможливо було прибрати з бібліотеки: DELETE знімав saved_at, а
-- список тримав рядок через cooked_count. Жорстке видалення не варіант —
-- cook_run.recipe_id ON DELETE CASCADE зніс би журнал. Тому мітка приховання.
ALTER TABLE recipe ADD COLUMN hidden_at timestamptz;
