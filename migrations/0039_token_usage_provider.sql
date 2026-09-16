-- 16.09: хто відповідав на виклик через OpenRouter (`provider` з тіла
-- відповіді: «Google» = Vertex, «Google AI Studio» …) і id генерації
-- (`x-generation-id`, той самий, що в їхньому логу /api/v1/generation?id=).
-- Затримки 30–45 с при 100 вихідних токенах — щоб бачити, чий це апстрім.
ALTER TABLE token_usage ADD COLUMN provider text;
ALTER TABLE token_usage ADD COLUMN generation_id text;
