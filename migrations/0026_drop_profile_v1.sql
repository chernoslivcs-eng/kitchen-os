-- Раунд 4, крок 11 (AUDIT-ROUND-4.md, п. 11 кроку 9): профіль v1 і memory_note
-- прибираються. Поведінка v2 (profile_text / profile_note / veto_index) —
-- єдина; прапор PROFILE_V2 у коді більше не читається.
--
-- Традиції жили в profile.traditions (0021) і потрібні календарю — переїжджають
-- на "user". null — людина ще не обирала (календар вгадує з її слів у
-- profile_text), порожній масив — обирала й вимкнула все.

ALTER TABLE "user" ADD COLUMN traditions text[];

UPDATE "user" u
   SET traditions = p.traditions
  FROM profile p
 WHERE p.user_id = u.id
   AND p.traditions IS NOT NULL;

-- Бекап перед drop: повні копії без FK та індексів. Читати руками, коли
-- щось із міграції 0023 виглядатиме дивно; за тиждень без питань — прибрати.
CREATE TABLE profile_archive AS TABLE profile;
CREATE TABLE memory_note_archive AS TABLE memory_note;

DROP TABLE profile;
DROP TABLE memory_note;
