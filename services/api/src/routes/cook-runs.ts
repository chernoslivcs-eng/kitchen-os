// POST /v1/cook-runs { recipe, servings?, rating?, verdict? } → { id, recipe_id }
// GET  /v1/cook-runs → { runs: CookRunWithRecipe[] }
//
// «Готове» з Cook Mode робить один POST і замикає цикл: рецепт зберігається як
// заморожений знімок у recipe, а cook_run фіксує факт готування конкретною людиною.
// Пізніше додасться списання партій, поживність за складом, рейтинг post-hoc.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { RecipeRow, Repo, CookRunBatchChange } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import type { Recipe } from '../model.js';

// Приводимо (value, unit) з рецепта до одиниць, у яких зберігається партія.
// Ті ж самі правила, що в domain/apply.ts normalizeUnit: l→ml, kg→g. Якщо
// одиниці несумісні (партія в pcs, рецепт у g) — повертаємо null: тоді
// на верхньому рівні спрацює повна депляція.
function normalizeForBatch(value: number | null, unit: string | null, batchUnit: string | null): number | null {
  if (value == null || unit == null || batchUnit == null) return null;
  const u = unit.toLowerCase();
  if (batchUnit === 'ml') {
    if (u === 'ml' || u === 'мл') return value;
    if (u === 'l' || u === 'л') return value * 1000;
    return null;
  }
  if (batchUnit === 'g') {
    if (u === 'g' || u === 'г') return value;
    if (u === 'kg' || u === 'кг') return value * 1000;
    return null;
  }
  if (batchUnit === 'pcs') {
    if (u === 'pcs' || u === 'шт' || u === 'штук' || u === 'штука') return value;
    return null;
  }
  if (batchUnit === 'pack') {
    if (u === 'pack' || u === 'пач' || u === 'пачка') return value;
    return null;
  }
  return null;
}

interface CookRunBody {
  recipe?: Recipe;
  servings?: number;
  rating?: number;
  verdict?: string;
}

export function cookRunsRoutes(app: FastifyInstance, repo: Repo) {
  app.post<{ Body: CookRunBody }>(
    '/v1/cook-runs',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id, household_id } = requireUser(req);
      const { recipe, servings, rating, verdict } = req.body ?? {};
      if (!recipe || !recipe.t || !Array.isArray(recipe.ing)) {
        return reply.code(400).send({ error: 'recipe with t and ing[] required' });
      }
      const now = new Date().toISOString();
      const recipe_id = randomUUID();

      // Enrich `ing.n` із коморних міток: модель показала пальцем через `ing.p`
      // (uuid партії), а на публічному /r/:id інший юзер уже не має цих партій.
      // Печемо назву в payload при збереженні — тоді SharedRecipe завжди показує
      // «моцарела», не голий uuid. Живе `ing.p` теж лишається — для алергічних
      // прапорців і для деплеції.
      const enrichedIng = await Promise.all(
        (recipe.ing ?? []).map(async (ing) => {
          if (ing.n || !ing.p) return ing;
          const b = await repo.getBatch(ing.p);
          if (b && b.household_id === household_id) return { ...ing, n: b.label };
          return ing;
        }),
      );
      const enrichedRecipe = { ...recipe, ing: enrichedIng };

      const recipeRow: RecipeRow = {
        id: recipe_id,
        owner_id: user_id,
        origin: 'generated',
        title: recipe.t,
        descr: recipe.d ?? null,
        character: recipe.ch ?? null,
        risk: recipe.rk ?? null,
        base_servings: recipe.sv ?? servings ?? 2,
        time_total: recipe.tm ?? null,
        nutrition: recipe.nu ?? null,
        payload: enrichedRecipe,
        created_at: now,
        // Cook-run зберігає рецепт як побічний ефект — не як «збережений».
        // «Лишити на потім» ставить saved_at через POST /v1/recipes.
        saved_at: null,
      };
      await repo.saveRecipe(recipeRow);

      const run_id = randomUUID();

      // Списання партій, на які модель поставила посилання (ing.p = batch id).
      // Часткове: якщо recipe.ing[i] має v/u сумісні з партією — віднімаємо. Якщо
      // після цього залишок ≤ 0 — партія депляцується. Одиниці конвертуємо
      // за тими ж правилами, що intake normalizeUnit: l→ml×1000, kg→g×1000.
      //
      // QA4-03: коли кількість невідома (модель віддала «q»:"400g" замість v/u,
      // або одиниці несумісні) — раніше депляцували ВСЮ партію. Для пляшки олії
      // й «2 ст.л» це знищувало пляшку. Тепер у такому разі просто позначаємо
      // партію відкритою: недосписання чесніше за тихе знищення.
      let depleted = 0;
      let partial = 0;
      let opened = 0;
      const depletedIds: string[] = [];
      const changes: CookRunBatchChange[] = [];
      for (const ing of recipe.ing ?? []) {
        if (!ing.p) continue;
        const batch = await repo.getBatch(ing.p);
        if (!batch || batch.household_id !== household_id) continue;
        if (batch.state === 'depleted') continue;

        const used = normalizeForBatch(ing.v ?? null, ing.u ?? null, batch.unit);

        if (used == null) {
          // Кількість невідома. Партію не чіпаємо крім стану — вона лишається
          // в коморі, юзер сам скоригує через шит партії, якщо треба.
          if (batch.state === 'sealed') {
            changes.push({
              id: batch.id,
              op: 'subtract',
              amount: 0,
              prev_state: batch.state,
              prev_value: batch.value,
              prev_opened_at: batch.opened_at,
            });
            await repo.updateBatch(batch.id, {
              state: 'opened',
              opened_at: now,
              last_by: user_id,
              last_action: 'cook',
            });
            opened++;
          }
          continue;
        }

        if (batch.value != null && batch.value > used) {
          changes.push({
            id: batch.id,
            op: 'subtract',
            amount: used,
            prev_state: batch.state,
            prev_value: batch.value,
            prev_opened_at: batch.opened_at,
          });
          await repo.updateBatch(batch.id, {
            value: Math.round((batch.value - used) * 100) / 100,
            state: batch.state === 'sealed' ? 'opened' : batch.state,
            opened_at: batch.opened_at ?? now,
            last_by: user_id,
            last_action: 'cook',
          });
          partial++;
        } else {
          // Вжили не менше залишку → партія справді закінчилась.
          changes.push({
            id: batch.id,
            op: 'deplete',
            prev_state: batch.state,
            prev_depleted_at: batch.depleted_at,
          });
          await repo.updateBatch(batch.id, {
            state: 'depleted',
            depleted_at: now,
            last_by: user_id,
            last_action: 'cook',
          });
          depletedIds.push(batch.id);
          depleted++;
        }
      }

      await repo.saveCookRun({
        id: run_id,
        household_id,
        user_id,
        recipe_id,
        servings: servings ?? recipe.sv ?? 2,
        started_at: now,
        finished_at: now,
        rating: rating ?? null,
        verdict: verdict ?? null,
        photo_url: null,
        changes: changes.length ? { batches: changes } : null,
        undone_at: null,
      });

      return reply.code(201).send({
        id: run_id,
        recipe_id,
        depleted,
        partial,
        opened,
        depleted_batch_ids: depletedIds,
      });
    },
  );

  // Ретро-оцінка: юзер міг натиснути «Готово», а рейтинг поставити пізніше
  // (або взагалі пропустити). Тому PATCH окремо від POST.
  app.patch<{ Params: { id: string }; Body: { rating?: number | null; verdict?: string | null; photo_url?: string | null } }>(
    '/v1/cook-runs/:id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const run = await repo.getCookRun(req.params.id);
      if (!run) return reply.code(404).send({ error: 'not_found' });
      if (run.user_id !== user_id) return reply.code(403).send({ error: 'not_yours' });
      const patch: Parameters<typeof repo.updateCookRun>[1] = {};
      if ('rating' in req.body) {
        if (req.body.rating != null && (typeof req.body.rating !== 'number' || req.body.rating < 1 || req.body.rating > 5)) {
          return reply.code(400).send({ error: 'rating_out_of_range' });
        }
        patch.rating = req.body.rating;
      }
      if ('verdict' in req.body) patch.verdict = req.body.verdict || null;
      if ('photo_url' in req.body) patch.photo_url = req.body.photo_url || null;
      await repo.updateCookRun(run.id, patch);
      const updated = await repo.getCookRun(run.id);
      return { updated: true, rating: updated?.rating ?? null, verdict: updated?.verdict ?? null, photo_url: updated?.photo_url ?? null };
    },
  );

  app.get('/v1/cook-runs', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id } = requireUser(req);
    const runs = await repo.listCookRuns(user_id, 30);
    return { runs };
  });

  // Розкат назад: партіям, що були депляцовані — повертаємо попередній стан;
  // тим, у кого віднімали — повертаємо попередній value і opened_at. Ідемпотентно:
  // повторний виклик по вже undone-ному пробіжаному run поверне 200 з {already: true}.
  app.post<{ Params: { id: string } }>(
    '/v1/cook-runs/:id/undo',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id, household_id } = requireUser(req);
      const run = await repo.getCookRun(req.params.id);
      if (!run) return reply.code(404).send({ error: 'not_found' });
      if (run.user_id !== user_id) return reply.code(403).send({ error: 'not_yours' });
      if (run.undone_at) return reply.send({ undone: true, already: true, restored: 0 });
      if (!run.changes) return reply.code(400).send({ error: 'no_changes_to_undo' });

      const now = new Date().toISOString();
      let restored = 0;
      for (const ch of run.changes.batches) {
        const batch = await repo.getBatch(ch.id);
        if (!batch || batch.household_id !== household_id) continue;
        if (ch.op === 'deplete') {
          await repo.updateBatch(ch.id, {
            state: ch.prev_state,
            depleted_at: ch.prev_depleted_at,
            last_by: user_id,
            last_action: 'undo_cook',
          });
          restored++;
        } else {
          // 'subtract' — повертаємо попередню кількість і opened_at.
          // Якщо hindsight: партія вже інша (юзер щось редагував уручну),
          // все одно повертаємо декларативно — це undo саме cook-run-у.
          await repo.updateBatch(ch.id, {
            value: ch.prev_value,
            state: ch.prev_state,
            opened_at: ch.prev_opened_at,
            last_by: user_id,
            last_action: 'undo_cook',
          });
          restored++;
        }
      }
      await repo.markCookRunUndone(run.id, now);
      return reply.send({ undone: true, already: false, restored });
    },
  );
}
