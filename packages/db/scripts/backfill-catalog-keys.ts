// Каталог, крок 5: ретро-прохід по наявних продуктах дому — дорезолвити
// catalog_key і привести теги у згоду з каталогом. Без моделі, ідемпотентний.
//
// Два різні правила, і плутати їх не можна:
//   · `allergens` — каталог доливає ТІЛЬКИ в дірку. Наявний тег не чіпається:
//     модель бачила пакет, каталог знає лише клас;
//   · `fasting`  — каталог перезаписує ЗАВЖДИ, в обидва боки. Скоромність це
//     властивість класу, і слово моделі тут не важить. Те саме правило, що в
//     `ensureProduct` (packages/domain/apply.ts) — заведене 09.09 після
//     виміру: в одному розборі чека модель дала `false` на фует, тунець,
//     камамбер і яйця, а `true` — на шпинат, часник і олію.
//
// Бренд, варіант і назва не чіпаються ніколи.
//
// ТИПОВИЙ РЕЖИМ — сухий: скрипт друкує, що змінив би, і НЕ пише. Це міграція
// даних над живою базою, тож запис вимагає явного `--apply`.
//
// Запуск: cd packages/db && pnpm tsx scripts/backfill-catalog-keys.ts
//         cd packages/db && pnpm tsx scripts/backfill-catalog-keys.ts --apply

import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { makePool } from '../pool.js';
import { PostgresRepo } from '../postgres-repo.js';
import { resolveLabelToKey } from '@kitchen/catalog';
import { BY_KEY } from '@kitchen/catalog/seed';
import { catalogGroupsToAllergens, isCatalogFasting, displayName, type ProductTags } from '@kitchen/domain';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });
const url = process.env.PG_URL;
if (!url) { console.error('PG_URL is required'); process.exit(1); }

const apply = process.argv.includes('--apply');
console.log(apply ? '— РЕЖИМ ЗАПИСУ (--apply)' : '— сухий прогін: нічого не пишеться (для запису дай --apply)');

const pool = makePool(url);
const repo = new PostgresRepo(pool);

const { rows: households } = await pool.query<{ id: string }>('SELECT id FROM household');
let keyed = 0, allergensFilled = 0, fastingFixed = 0, untouched = 0;

const show = (v: unknown) => (v === undefined ? '∅' : JSON.stringify(v));

for (const h of households) {
  for (const prod of await repo.listProducts(h.id)) {
    const patch: { catalog_key?: string; tags?: ProductTags } = {};
    const changes: string[] = [];
    let key = prod.catalog_key;
    if (!key) {
      key = resolveLabelToKey(prod.product) ?? resolveLabelToKey(displayName(prod));
      if (key) { patch.catalog_key = key; keyed++; changes.push(`catalog_key ∅ → ${key}`); }
    }
    const cat = key ? BY_KEY.get(key) : undefined;
    if (cat) {
      const tags: ProductTags = { ...prod.tags };
      let touched = false;
      if (tags.allergens === undefined) {
        const fromCat = catalogGroupsToAllergens(cat.allergen_groups);
        if (fromCat.length) {
          changes.push(`allergens ∅ → ${show(fromCat)}`);
          tags.allergens = fromCat; touched = true; allergensFilled++;
        }
      }
      // Не «в дірку», а вирівнювання: і `false→true`, і `true→false`.
      const catFasting = isCatalogFasting(cat);
      if (tags.fasting !== catFasting) {
        changes.push(`fasting ${show(tags.fasting)} → ${catFasting}`);
        tags.fasting = catFasting; touched = true; fastingFixed++;
      }
      if (touched) patch.tags = tags;
    }
    if (Object.keys(patch).length) {
      console.log(`  «${displayName(prod)}»  [${key ?? '∅'}]  ${changes.join(' · ')}`);
      if (apply) await repo.updateProduct(prod.id, patch);
    } else untouched++;
  }
}
console.log(`\nключів дорезолвлено: ${keyed}, allergens долито: ${allergensFilled}, fasting вирівняно: ${fastingFixed}, без змін: ${untouched}`);
if (!apply) console.log('нічого не записано — це був сухий прогін');
await pool.end();
