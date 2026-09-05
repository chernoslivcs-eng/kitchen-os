-- Раунд 4, крок 7 (і AUDIT-NEXT-STEPS «Семен на сервері»): позначки на
-- користувачі, а не в localStorage. welcome_seen_at — бачив Семена;
-- profile_onboarding_at — картку «Про тебе» в стрічці вже видано (один раз).
ALTER TABLE "user"
  ADD COLUMN welcome_seen_at timestamptz,
  ADD COLUMN profile_onboarding_at timestamptz;
