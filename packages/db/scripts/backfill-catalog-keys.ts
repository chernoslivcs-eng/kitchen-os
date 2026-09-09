// Каталог, крок 5: ретро-прохід по наявних продуктах дому — привести
// `catalog_key` і похідні теги у згоду з каталогом. Без моделі, ідемпотентний.
//
// ТРИ РІЗНІ ПРАВИЛА, і плутати їх не можна:
//
//   · `catalog_key` без `--rekey` — доливається тільки в ДІРКУ (як було);
//     з `--rekey` — переглядається й для наявних. Саме рішення живе в
//     `rekey.ts` і там же під тестом;
//   · `allergens` — каталог доливає ТІЛЬКИ в дірку. Наявний тег не чіпається:
//     модель бачила пакет, каталог знає лише клас;
//   · `fasting`  — каталог перезаписує ЗАВЖДИ, в обидва боки. Скоромність це
//     властивість класу, і слово моделі тут не важить. Те саме правило, що в
//     `ensureProduct` (packages/domain/apply.ts) — заведене 09.09 після
//     виміру: в одному розборі чека модель дала `false` на фует, тунець,
//     камамбер і яйця, а `true` — на шпинат, часник і олію.
//
// Скоромність рахується за НОВИМ ключем, у тому самому проході: інакше
// довелося б ганяти скрипт двічі, а між прогонами в базі стояли б значення,
// виведені зі старого ключа.
//
// Стертий ключ теги НЕ чистить. Звідки взялося `fasting`, яке вже стоїть —
// із каталогу чи від моделі — по рядку не видно, і затирати чуже знання
// заради охайності дорожче, ніж лишити. Наслідок названий прямо: «пакети
// біорозкладні» після стирання ключа лишаться скоромними, поки хтось не
// виправить руками.
//
// Бренд, варіант і назва не чіпаються ніколи.
//
// ТИПОВИЙ РЕЖИМ — сухий: скрипт друкує, що змінив би, і НЕ пише. Це міграція
// даних над живою базою, тож запис вимагає явного `--apply`.
//
// Запуск: cd packages/db && pnpm tsx scripts/backfill-catalog-keys.ts
//         cd packages/db && pnpm tsx scripts/backfill-catalog-keys.ts --rekey
//         cd packages/db && pnpm tsx scripts/backfill-catalog-keys.ts --rekey --apply

import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { makePool } from '../pool.js';
import { PostgresRepo } from '../postgres-repo.js';
import { BY_KEY } from '@kitchen/catalog/seed';
import { catalogGroupsToAllergens, isCatalogFasting, displayName, type ProductTags } from '@kitchen/domain';
import { decideKey } from './rekey.js';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });
const url = process.env.PG_URL;
if (!url) { console.error('PG_URL is required'); process.exit(1); }

const apply = process.argv.includes('--apply');
const rekey = process.argv.includes('--rekey');
console.log(apply ? '— РЕЖИМ ЗАПИСУ (--apply)' : '— сухий прогін: нічого не пишеться (для запису дай --apply)');
console.log(rekey ? '— --rekey: наявні ключі переглядаються' : '— без --rekey: наявні ключі не чіпаються, доливаються лише порожні');

const pool = makePool(url);
const repo = new PostgresRepo(pool);

const { rows: households } = await pool.query<{ id: string }>('SELECT id FROM household');
const stat = { filled: 0, rekeyed: 0, erased: 0, allergens: 0, fasting: 0, untouched: 0 };

const show = (v: unknown) => (v === undefined ? '∅' : JSON.stringify(v));

for (const h of households) {
  for (const prod of await repo.listProducts(h.id)) {
    const patch: { catalog_key?: string | null; tags?: ProductTags } = {};
    const changes: string[] = [];

    const d = decideKey(prod.catalog_key, prod.product, displayName(prod));
    // Без --rekey живою лишається тільки стара гілка: долити порожній ключ.
    const keyMoves = d.action === 'fill' || (rekey && (d.action === 'rekey' || d.action === 'erase'));
    const key = keyMoves ? d.key : prod.catalog_key;
    if (keyMoves) {
      patch.catalog_key = d.key;
      changes.push(`catalog_key ${d.why}`);
      if (d.action === 'fill') stat.filled++;
      else if (d.action === 'rekey') stat.rekeyed++;
      else stat.erased++;
    }

    const cat = key ? BY_KEY.get(key) : undefined;
    if (cat) {
      const tags: ProductTags = { ...prod.tags };
      let touched = false;
      if (tags.allergens === undefined) {
        const fromCat = catalogGroupsToAllergens(cat.allergen_groups);
        if (fromCat.length) {
          changes.push(`allergens ∅ → ${show(fromCat)}`);
          tags.allergens = fromCat; touched = true; stat.allergens++;
        }
      }
      // Не «в дірку», а вирівнювання: і `false→true`, і `true→false`.
      const catFasting = isCatalogFasting(cat);
      if (tags.fasting !== catFasting) {
        changes.push(`fasting ${show(tags.fasting)} → ${catFasting}`);
        tags.fasting = catFasting; touched = true; stat.fasting++;
      }
      if (touched) patch.tags = tags;
    }

    if (Object.keys(patch).length) {
      console.log(`  «${displayName(prod)}»  ${changes.join(' · ')}`);
      if (apply) await repo.updateProduct(prod.id, patch);
    } else stat.untouched++;
  }
}
console.log(`\nключів долито: ${stat.filled}, перекладено: ${stat.rekeyed}, стерто: ${stat.erased}`
  + ` · allergens долито: ${stat.allergens}, fasting вирівняно: ${stat.fasting} · без змін: ${stat.untouched}`);
if (!apply) console.log('нічого не записано — це був сухий прогін');
await pool.end();
