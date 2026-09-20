-- Рішення власника 20.09: фото в Telegram — завжди одразу в комору, як текст
-- і голос. Серія «наповнюю комору» (0042, 19.09) прожила день — стан не потрібен.
ALTER TABLE telegram_account DROP COLUMN IF EXISTS intake_streak_until;
ALTER TABLE telegram_account DROP COLUMN IF EXISTS intake_streak_last_apply;
