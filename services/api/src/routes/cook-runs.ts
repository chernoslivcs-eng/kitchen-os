// POST /v1/cook-runs { recipe, servings?, rating?, verdict? } → { id, recipe_id }
// GET  /v1/cook-runs → { runs: CookRunWithRecipe[] }
//
// «Готове» з Cook Mode робить один POST і замикає цикл: рецепт зберігається як
// заморожений знімок у recipe, а cook_run фіксує факт готування конкретною людиною.
// Пізніше додасться списання партій, поживність за складом, рейтинг post-hoc.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { RecipeRow, Repo } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import type { Recipe } from '../model.js';

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
        payload: recipe,
        created_at: now,
      };
      await repo.saveRecipe(recipeRow);

      const run_id = randomUUID();
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
      });

      return reply.code(201).send({ id: run_id, recipe_id });
    },
  );

  app.get('/v1/cook-runs', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id } = requireUser(req);
    const runs = await repo.listCookRuns(user_id, 30);
    return { runs };
  });
}
