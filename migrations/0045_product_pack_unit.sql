-- Упаковане (строки v2, PR 4): household_product.pack_size — вага/обʼєм ОДНІЄЇ
-- одиниці, а колонка була числом без одиниці. pack_unit — g | ml. Старі рядки
-- (pack_size у 0 зі 180 продуктів на проді) не мігруються.
ALTER TABLE household_product ADD COLUMN pack_unit text CHECK (pack_unit IN ('g', 'ml'));
