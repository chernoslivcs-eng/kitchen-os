// Переприсвоєння catalog_key у живих даних — власник ухвалив, 22.09.2026.
// Для кожного household_product проганяє поточний резолвер (decideReassign,
// той самий anchored/generic каскад, що rekey.ts, #197) і порівнює з тим, що
// вже стоїть:
//   · ключа нема, резолвер дає  → проставити
//   · ключ є, резолвер дає ІНШИЙ → переписати
//   · резолвер мовчить          → НЕ чіпати НІКОЛИ (ключ теж не стирається —
//     навпаки decideKey/rekey.ts, який тут навмисно НЕ використовується
//     напряму; деталі в reassign-catalog-keys-decide.ts).
//
// ТИПОВИЙ РЕЖИМ — сухий: друкує звіт, нічого не пише. Запис лише з
// ЯВНИМ --apply, і лише в транзакції (усе або нічого).
//
// Перед записом: старі значення йдуть у лог-файл (audit-materials/, поза
// git) — з нього можна відкотити через --rollback <файл>.
//
// Захист від «переписали пів бази через баг у резолвері»: якщо кількість
// правок (fill+rekey) більша за очікувані ~40 (аудит: 8 rekey + 29 fill),
// --apply без --confirm-large відмовляється писати.
//
// Запуск:
//   cd packages/db && pnpm tsx scripts/reassign-catalog-keys.ts                    # сухий звіт
//   cd packages/db && pnpm tsx scripts/reassign-catalog-keys.ts --apply            # запис
//   cd packages/db && pnpm tsx scripts/reassign-catalog-keys.ts --apply --confirm-large   # запис, >40 правок
//   cd packages/db && pnpm tsx scripts/reassign-catalog-keys.ts --rollback audit-materials/catalog-key-reassign-log/<файл>.json

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import { makePool } from '../pool.js';
import { PostgresRepo } from '../postgres-repo.js';
import { displayName } from '@kitchen/domain';
import { decideReassign, exceedsLimit, EXPECTED_MAX } from './reassign-catalog-keys-decide.js';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });
const url = process.env.PG_URL;
if (!url) { console.error('PG_URL is required'); process.exit(1); }

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const confirmLarge = argv.includes('--confirm-large');
const rollbackIdx = argv.indexOf('--rollback');
const rollbackFile = rollbackIdx >= 0 ? argv[rollbackIdx + 1] : null;

const LOG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../audit-materials/catalog-key-reassign-log');

const pool = makePool(url);

interface Change {
  household_id: string;
  product_id: string;
  product: string;
  brand: string | null;
  variant: string | null;
  name: string; // displayName, для звіту
  old_key: string | null;
  new_key: string | null;
  why: string;
}

async function runRollback(file: string): Promise<void> {
  const entries: Change[] = JSON.parse(readFileSync(file, 'utf-8'));
  console.log(`— відкат ${entries.length} правок із ${file}`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      console.log(`  «${e.name}» ${e.new_key ?? '∅'} → ${e.old_key ?? '∅'} (household ${e.household_id})`);
      await client.query('UPDATE household_product SET catalog_key = $1 WHERE id = $2', [e.old_key, e.product_id]);
    }
    await client.query('COMMIT');
    console.log(`\nвідкочено: ${entries.length}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (rollbackFile) {
  await runRollback(rollbackFile);
  await pool.end();
  process.exit(0);
}

// Сухий прогін проти прод-бази (PG_URL локалки = прод Neon) — захист від
// випадкового запису, навіть якщо десь у коді нижче закралась би помилка:
// у --apply-гілці той самий пул використовується вже без цього обмеження.
if (!apply) await pool.query('SET default_transaction_read_only = on');

console.log(apply ? '— РЕЖИМ ЗАПИСУ (--apply)' : '— сухий прогін: нічого не пишеться (для запису дай --apply)');

const repo = new PostgresRepo(pool);
const { rows: households } = await pool.query<{ id: string }>('SELECT id FROM household');

const fills: Change[] = [];
const rekeys: Change[] = [];
let keptConfirmed = 0;
let keptSilent = 0;

for (const h of households) {
  for (const prod of await repo.listProducts(h.id)) {
    const dn = displayName(prod);
    const d = decideReassign(prod.catalog_key, prod.product, dn);
    const change: Change = {
      household_id: h.id, product_id: prod.id, product: prod.product, brand: prod.brand, variant: prod.variant,
      name: dn, old_key: prod.catalog_key, new_key: d.key, why: d.why,
    };
    if (d.action === 'fill') fills.push(change);
    else if (d.action === 'rekey') rekeys.push(change);
    // 'keep' — резолвер мовчить (наш never-erase) чи підтверджує наявне;
    // decideKey сам розрізняє це в тексті `why` («мовчить» — тиша).
    else if (d.why.includes('мовчить')) keptSilent++;
    else keptConfirmed++;
  }
}

const total = fills.length + rekeys.length;

console.log(`\n=== проставити (${fills.length}) ===`);
for (const c of fills) console.log(`  «${c.name}»  ∅ → ${c.new_key}  [дім ${c.household_id}]`);

console.log(`\n=== переписати (${rekeys.length}) ===`);
for (const c of rekeys) console.log(`  «${c.name}»  ${c.old_key} → ${c.new_key}  [дім ${c.household_id}]`);

console.log(`\nпідсумок: проставити ${fills.length}, переписати ${rekeys.length}`
  + ` · не чіпаємо: резолвер мовчить ${keptSilent}, резолвер підтверджує ${keptConfirmed}`
  + ` · разом правок: ${total}`);

if (!apply) {
  console.log('\nнічого не записано — це був сухий прогін');
  await pool.end();
  process.exit(0);
}

if (exceedsLimit(total) && !confirmLarge) {
  console.error(`\nСТОП: ${total} правок — більше за очікувані ${EXPECTED_MAX} (аудит: 8 rekey + 29 fill).`
    + ` Це саме той захист, що просив власник: «переписали пів бази через баг у резолвері».`
    + ` Якщо цифра дійсно очікувана — перезапусти з --apply --confirm-large.`);
  await pool.end();
  process.exit(1);
}

mkdirSync(LOG_DIR, { recursive: true });
const logPath = resolve(LOG_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(logPath, JSON.stringify([...fills, ...rekeys], null, 2) + '\n');
console.log(`\nлог старих значень (для --rollback): ${logPath}`);

const client = await pool.connect();
try {
  await client.query('BEGIN');
  for (const c of [...fills, ...rekeys]) {
    await client.query('UPDATE household_product SET catalog_key = $1 WHERE id = $2', [c.new_key, c.product_id]);
  }
  await client.query('COMMIT');
  console.log(`\nзаписано: ${total} (${fills.length} проставлено, ${rekeys.length} переписано)`);
} catch (err) {
  await client.query('ROLLBACK');
  console.error('ПОМИЛКА — транзакція відкочена, нічого не записано:', err);
  process.exitCode = 1;
} finally {
  client.release();
}

await pool.end();
