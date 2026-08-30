-- Черга Д (правка №2): «продукт дому» — трійка product·brand·variant.
-- Видима назва формується з трійки; невидимі теги (алергени, скоромне,
-- алкоголь, лактоза, processing, shelf_open_days) — jsonb. Каталог лишається
-- дефолтами для тегера; продукт дому — істина дому.

CREATE TABLE household_product (
  id           uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  product      text NOT NULL,
  brand        text,
  variant      text,
  unit         text,             -- канонічна одиниця обліку: g | ml | pcs
  pack_size    numeric,          -- «1 пач = 500 г» — списання стає числом
  tags         jsonb NOT NULL DEFAULT '{}'::jsonb,
  catalog_key  text REFERENCES catalog_ingredient(key),
  created_at   timestamptz NOT NULL
);

-- Суворий збіг трійки без регістру: інший бренд = інший продукт,
-- а «Galbani» і «galbani» — один.
CREATE UNIQUE INDEX household_product_triple_uq
  ON household_product (household_id, lower(product), coalesce(lower(brand), ''), coalesce(lower(variant), ''));

-- Партія показує на продукт дому. Старі партії лишаються з NULL до бекфілу;
-- label — самодостатній фолбек.
ALTER TABLE pantry_batch
  ADD COLUMN product_id uuid REFERENCES household_product(id) ON DELETE SET NULL;
