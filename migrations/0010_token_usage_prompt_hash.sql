-- A3 (OPTIMIZATION_PLAN, TOKEN_AUDIT п.2+5): редагування промпт-файлів «на
-- місці» проходило під незмінним prompt_version (+3,2k ток./виклик невидимо).
-- Хеш і довжина скомпонованого стабільного префікса — на кожен live-виклик:
-- зміна тексту видима в даних постфактум; prompt_version лишається
-- людинозчитним. Бонус: зміна hash ↔ сплеск cache_write = детектор
-- інвалідації кешу.
ALTER TABLE token_usage ADD COLUMN prompt_hash text;
ALTER TABLE token_usage ADD COLUMN prompt_chars int;
