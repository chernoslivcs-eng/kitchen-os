-- 17.09: точна ціна виклику від OpenRouter (GET /api/v1/generation?id=…,
-- total_cost, USD). Формула в pricing.ts — оцінка; для Gemini вона завищувала
-- ~2× (cache_creation_input_tokens = cache_read там — не запис). Заповнюється
-- лінивим бекфілом у /v1/admin/money (≤ 50 рядків за запит), null — ще не
-- підтягнуто.
ALTER TABLE token_usage ADD COLUMN usd_actual numeric;
