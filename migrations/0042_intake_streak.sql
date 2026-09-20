-- Серія «наповнюю комору» в Telegram (19.09): 79 фото = 70 тапів «У комору».
-- Стан на акаунті, бо лямбда: until — серія активна, поки now < until;
-- last_apply — два apply поспіль за 15 хв вмикають серію.
ALTER TABLE telegram_account ADD COLUMN intake_streak_until timestamptz;
ALTER TABLE telegram_account ADD COLUMN intake_streak_last_apply timestamptz;
