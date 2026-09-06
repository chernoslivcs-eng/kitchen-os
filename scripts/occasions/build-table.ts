// Раунд 5, крок П1: таблиця дат приводів наперед → data/occasions/table.json.
//
// Джерело — той самий довідник і та сама арифметика, що працюють у сервері
// (packages/domain: occasion-data.ts + occasion-rules.ts + periods.ts):
// Великдень і похідні — пасхалія обох традицій; юдейські — гебрейський
// календар (hebrew-calendar.ts, звірено з @hebcal/core 6.9.2); ісламські —
// табличний календар з approx: true (±1 день); світські й сезони — фіксовані
// вікна. Модель сирих правил не бачить — лише готові дати в [ЗАРАЗ]; ця
// таблиця — те саме для людини й для тесту «без дірок на пʼять років»
// (packages/domain/occasion-table.test.ts звіряє файл із обчисленням).
//
// Запуск із кореня: npx tsx scripts/occasions/build-table.ts

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOccasionTable, TABLE_YEARS, BUILTIN_OCCASIONS } from '../../packages/domain/index.js';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/occasions/table.json');
const entries = buildOccasionTable(BUILTIN_OCCASIONS, TABLE_YEARS);
const doc = {
  years: [...TABLE_YEARS],
  note: 'from/to включно, YYYY-MM-DD; approx — місячний календар, ±1 день; юдейські вікна починаються ввечері напередодні; tradition у Великодня — за чиєю пасхалією',
  entries,
};
writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
console.log(`${out}: ${entries.length} рядків, ${new Set(entries.map((e) => e.occasion_id)).size} приводів, роки ${TABLE_YEARS.join('–')}`);
