// POST /v1/recipes/generate  { title, context? }
//   → { recipe, meta, usage }
// Персистенції рецепта поки нема — фронт тримає його в стані React-Router до
// перезавантаження. Коли зʼявиться таблиця recipe і CookRun — додамо GET/POST /v1/recipes/:id.

import type { FastifyInstance } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { callRecipe } from '../model.js';
import { authenticated, requireUser } from '../middleware/session.js';
import { recordUsage } from '../usage.js';

export function recipesRoutes(app: FastifyInstance, repo: Repo) {
  app.post<{
    Body: { title?: string; context?: string };
  }>('/v1/recipes/generate', { preHandler: authenticated(repo) }, async (req, reply) => {
    const ctx = requireUser(req);
    const { title, context } = req.body ?? {};
    if (!title || !title.trim()) return reply.code(400).send({ error: 'title required' });

    const pantry = await repo.listBatches(ctx.household_id);
    const started = Date.now();
    const call = await callRecipe({ title: title.trim(), context, pantry });
    await recordUsage(repo, ctx, 'recipe_gen', call.meta, call.usage, started);

    if (!call.recipe) {
      return reply.code(502).send({ error: 'model_returned_no_recipe', raw: call.raw.slice(0, 400) });
    }
    return { recipe: call.recipe, meta: call.meta, usage: call.usage };
  });
}
