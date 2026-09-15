// GENERIC-0915: разовий бекфіл ключів для продуктів без catalog_key — тим
// самим шляхом, що ensureProduct (ядро: @kitchen/domain backfillGenericKeys).
// Пише ЛИШЕ де ключ знайшовся; наявні ключі не чіпає. Ідемпотентний.
//
// ТИПОВИЙ РЕЖИМ — сухий. Запис — лише з явним --apply.
// Прод — не звідси: власник запускає POST /v1/admin/backfill-generic-keys?apply=1
// (той самий лог). Скрипт — для стенда/локальної бази.
//
// Запуск: cd packages/db && pnpm tsx scripts/backfill-generic-keys.ts
//         cd packages/db && pnpm tsx scripts/backfill-generic-keys.ts --apply
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { makePool } from '../pool.js';
import { PostgresRepo } from '../postgres-repo.js';
import { backfillGenericKeys, formatBackfillLog } from '@kitchen/domain';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });
const url = process.env.PG_URL;
if (!url) { console.error('PG_URL is required'); process.exit(1); }
const apply = process.argv.includes('--apply');
console.log(apply ? '— РЕЖИМ ЗАПИСУ (--apply)' : '— сухий прогін: нічого не пишеться (для запису дай --apply)');

const pool = makePool(url);
const log = await backfillGenericKeys(new PostgresRepo(pool), { apply });
for (const f of log.filled) console.log(`  «${f.product}» → ${f.key} (${f.name})`);
console.log('\n' + formatBackfillLog(log));
await pool.end();
