// QA9-01, одноразовий бекфіл. Рецепти, згенеровані ДО вморожування назв,
// тримають інгредієнти голими `p`-вказівниками — коли партію списали чи
// перейменували, стрічка показувала «з комори», кроки — «Інгредієнт»
// (скріни Пилипа з тостом). Проходимо всі recipe.payload і всі
// message.card типу recipe_link, підставляємо n з pantry_batch —
// ВКЛЮЧНО зі списаними партіями: рядки в БД лишаються, назви відновні.
//
// Запуск: pnpm --filter @kitchen/db exec tsx scripts/backfill-recipe-labels.ts   (читає PG_URL з .env)
// Ідемпотентний: ing з наявним n не чіпає. Повторити на проді після деплою.

import { Pool } from 'pg';
import { readFileSync } from 'node:fs';

// .env руками — щоб не тягнути dotenv у корінь.
try {
  for (const line of readFileSync(new URL('../../../.env', import.meta.url), 'utf-8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!;
  }
} catch { /* нема .env — очікуємо PG_URL в оточенні */ }

const url = process.env.PG_URL;
if (!url) { console.error('PG_URL не задано'); process.exit(1); }

interface Ing { p?: string; n?: string; [k: string]: unknown }

function fill(ing: Ing[] | undefined, labels: Map<string, string>): { changed: boolean; ing: Ing[] } {
  let changed = false;
  const out = (ing ?? []).map((i) => {
    if (i.p && !i.n) {
      const label = labels.get(i.p);
      if (label) { changed = true; return { ...i, n: label }; }
    }
    return i;
  });
  return { changed, ing: out };
}

async function main() {
  const pool = new Pool({ connectionString: url });

  // Назви всіх партій — активних і списаних.
  const batches = await pool.query<{ id: string; label: string }>('SELECT id, label FROM pantry_batch');
  const labels = new Map(batches.rows.map((b) => [b.id, b.label]));
  console.log(`партій у довіднику: ${labels.size}`);

  // 1. recipe.payload
  const recipes = await pool.query<{ id: string; payload: { ing?: Ing[] } }>('SELECT id, payload FROM recipe');
  let fixedRecipes = 0;
  for (const r of recipes.rows) {
    const { changed, ing } = fill(r.payload?.ing, labels);
    if (changed) {
      await pool.query('UPDATE recipe SET payload = $1 WHERE id = $2', [{ ...r.payload, ing }, r.id]);
      fixedRecipes++;
    }
  }
  console.log(`рецептів оновлено: ${fixedRecipes} з ${recipes.rowCount}`);

  // 2. message.card (recipe_link несе повну копію рецепта)
  const msgs = await pool.query<{ id: string; card: { type?: string; recipe?: { ing?: Ing[] } } }>(
    `SELECT id, card FROM message WHERE card->>'type' = 'recipe_link' AND card ? 'recipe'`,
  );
  let fixedMsgs = 0;
  for (const m of msgs.rows) {
    const { changed, ing } = fill(m.card.recipe?.ing, labels);
    if (changed) {
      await pool.query('UPDATE message SET card = $1 WHERE id = $2', [
        { ...m.card, recipe: { ...m.card.recipe, ing } }, m.id,
      ]);
      fixedMsgs++;
    }
  }
  console.log(`recipe_link-повідомлень оновлено: ${fixedMsgs} з ${msgs.rowCount}`);

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
