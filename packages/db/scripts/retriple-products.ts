// Пул-2 №11: разове дорозкладання бекфіл-продуктів на трійки. Бекфіл клав
// весь label у product («пиво Kronenborg blanc»); тут haiku (t=0) розкладає
// на product·brand·variant, сервер оновлює продукти і формує labels партій.
// Ідемпотентний: чіпає лише продукти з brand IS NULL AND variant IS NULL,
// «не впевнений» від моделі = лишити як є.
//
// Запуск: cd packages/db && pnpm tsx scripts/retriple-products.ts

import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { makePool } from '../pool.js';
import { PostgresRepo } from '../postgres-repo.js';
import { normalizeTriple, displayName } from '@kitchen/domain';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });
const PG_URL = process.env.PG_URL;
const OR_KEY = process.env.OPENROUTER_API_KEY;
if (!PG_URL || !OR_KEY) { console.error('PG_URL і OPENROUTER_API_KEY обовʼязкові'); process.exit(1); }

const pool = makePool(PG_URL);
const repo = new PostgresRepo(pool);

const { rows } = await pool.query<{ id: string; product: string; household_id: string }>(
  'SELECT id, product, household_id FROM household_product WHERE brand IS NULL AND variant IS NULL',
);
if (!rows.length) { console.log('нічого розкладати'); await pool.end(); process.exit(0); }
console.log(`кандидатів: ${rows.length}`);

const prompt = `Розклади назви продуктів на трійку: product (базова назва без бренду, українською як у вихідній назві), brand (виробник, якщо він Є в назві), variant (сорт/жирність/форма/об'єм-характеристика, якщо є). НЕ вигадуй: якщо бренду чи варіанта в назві немає — постав null. Якщо назва — це вже чистий product («сіль», «часник свіжий») — поверни її як product і null-и. Відповідь — ТІЛЬКИ JSON-масив без обгорток: [{"id":"...","product":"...","brand":"..."|null,"variant":"..."|null}]

Назви:
${JSON.stringify(rows.map((r) => ({ id: r.id, name: r.product })))}`;

const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${OR_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'anthropic/claude-haiku-4.5',
    temperature: 0,
    max_tokens: 12000,
    messages: [{ role: 'user', content: prompt }],
  }),
});
if (!resp.ok) { console.error('модель:', resp.status, await resp.text()); await pool.end(); process.exit(1); }
const data = await resp.json() as { choices: { message: { content: string } }[]; usage?: unknown };
const text = data.choices[0]!.message.content.replace(/^```json?\s*|```\s*$/g, '').trim();
let triples: { id: string; product?: string | null; brand?: string | null; variant?: string | null }[];
try { triples = JSON.parse(text); } catch (e) {
  console.error('JSON не розпарсився:', (e as Error).message, text.slice(0, 300));
  await pool.end(); process.exit(1);
}
console.log('usage:', JSON.stringify(data.usage));

const byId = new Map(rows.map((r) => [r.id, r]));
let updated = 0, kept = 0, relabeled = 0;
for (const t of triples) {
  const row = byId.get(t.id);
  if (!row || !t.product) { kept++; continue; }
  const triple = normalizeTriple({ product: t.product, brand: t.brand, variant: t.variant });
  if (!triple.product) { kept++; continue; }
  if (!triple.brand && !triple.variant && triple.product === row.product) { kept++; continue; }
  // Суворий збіг: якщо така трійка вже існує в домі — не плодимо дубль, лишаємо.
  const clash = await repo.findProductByTriple(row.household_id, triple);
  if (clash && clash.id !== t.id) { kept++; continue; }
  await repo.updateProduct(t.id, triple);
  updated++;
  // Назва партії формується з трійки — оновлюємо labels живих партій продукту.
  const { rows: batches } = await pool.query<{ id: string }>(
    "SELECT id FROM pantry_batch WHERE product_id = $1 AND state <> 'depleted'", [t.id],
  );
  for (const b of batches) {
    await repo.updateBatch(b.id, { label: displayName(triple) });
    relabeled++;
  }
}
console.log(`оновлено продуктів: ${updated}, без змін: ${kept}, перепідписано партій: ${relabeled}`);
await pool.end();
