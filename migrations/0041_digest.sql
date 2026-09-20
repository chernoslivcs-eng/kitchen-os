-- Ранковий дайджест дому (DIGEST-PLAN-0917, PR 1).
-- digest_enabled — опт-аут (/digest off у боті, перемикач у профілі — PR 2), дефолт true.
-- digest_sent_on — локальний день (YYYY-MM-DD) останньої відправки: раз на день.
-- tz — часовий пояс людини (IANA); NULL → Europe/Kyiv. Профіль поки не задає,
-- колонка — щоб крон уже читав його звідси, коли зʼявиться.
ALTER TABLE "user" ADD COLUMN digest_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE "user" ADD COLUMN digest_sent_on date;
ALTER TABLE "user" ADD COLUMN tz text;
