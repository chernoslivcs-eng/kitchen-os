-- Аудит раунд 3, крок 1: відхилення confirm-картки («Ні») мусить пережити
-- F5 і бути видимим моделі. Досі «Ні» був чисто клієнтським React-станом
-- (Feed.tsx dismissCard) — нічого не писалось у card_pending, і після
-- перезавантаження картка знову виглядала як [НЕ ЗАСТОСОВАНО — чекає тапу].
ALTER TABLE card_pending ADD COLUMN dismissed_at timestamptz;
