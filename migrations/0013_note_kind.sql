-- Пул-2 №6: нотатка має вид — висновок (lesson, як було) або намір (intent,
-- «тунець → seared»). Наміри модель нагадує, коли складники в наявності.

ALTER TABLE memory_note
  ADD COLUMN kind text NOT NULL DEFAULT 'lesson' CHECK (kind IN ('lesson', 'intent'));
