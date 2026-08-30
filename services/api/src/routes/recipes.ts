// POST /v1/recipes/generate  { title, context? }
//   → { recipe, meta, usage }
// Персистенції рецепта поки нема — фронт тримає його в стані React-Router до
// перезавантаження. Коли зʼявиться таблиця recipe і CookRun — додамо GET/POST /v1/recipes/:id.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { matchRecipe, type RecipeIngredient } from '@kitchen/domain';
import type { Repo } from '@kitchen/domain';
import { callRecipe } from '../model.js';
import type { Recipe, RecipeIng } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { recordUsage } from '../usage.js';
import { makeRateLimiter } from '../rate-limit.js';

export function recipesRoutes(app: FastifyInstance, repo: Repo) {
  // Публічний рецепт — без auth. Обмежуємо по IP щоб не могли скраулити всі UUID
  // (їх ~10^38 варіантів, але навіть спроба — це витрата ресурсів). 60/хв на IP
  // достатньо для реального юзера, замало для сканера.
  const publicLimiter = makeRateLimiter({ max: 60, windowMs: 60_000 });
  const publicLimit = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!publicLimiter.check(req.ip)) {
      reply.code(429).send({ error: 'too many requests' });
      return reply;
    }
  };

  // Recipe generation — теж дорогий model call. Ліміт нижчий, ніж у chat, бо
  // юзер клікає «Рецепт →» рідше, ніж пише в композитор. 10/хв per user_id.
  const genLimiter = makeRateLimiter({ max: 10, windowMs: 60_000 });
  const genLimit = async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = requireUser(req);
    if (!genLimiter.check(ctx.user_id)) {
      reply.code(429).send({ error: 'too many requests' });
      return reply;
    }
  };

  app.post<{
    Body: { title?: string; context?: string };
  }>('/v1/recipes/generate', { preHandler: [authenticated(repo), genLimit] }, async (req, reply) => {
    const ctx = requireUser(req);
    const { title, context } = req.body ?? {};
    if (!title || !title.trim()) return reply.code(400).send({ error: 'title required' });

    const pantry = await repo.listBatches(ctx.household_id);
    const profile = await repo.getProfile(ctx.user_id);
    const started = Date.now();
    const call = await callRecipe({ title: title.trim(), context, pantry, profile });
    await recordUsage(repo, ctx, 'recipe_gen', call.meta, call.usage, started);

    if (!call.recipe) {
      // QA4-06: раніше тут був 502, і людина бачила помилку там, де модель
      // правильно сказала, що завдання неоднозначне («400 г лосося — це мало
      // на шістьох»). Тепер це діалог: клієнт покаже reply як репліку кухаря.
      req.log.info({ raw: call.raw.slice(0, 200) }, 'recipe-returned-prose-not-json');
      // QA5-06: `raw` — сирий текст моделі, а цей канал обходить контракт із
      // card-rules.md. Зачищаємо маркдаун, інакше юзер бачить зірочки як текст.
      const clean = call.raw
        .replace(/\*\*/g, '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^\s*[-*]\s+/gm, '')
        .replace(/`/g, '')
        .replace(/\n{2,}/g, ' ')
        .trim()
        .slice(0, 400);
      return reply.send({ recipe: null, reply: clean, meta: call.meta, usage: call.usage });
    }

    // QA4-03: модель вигадує схему `ing`, коли промпт її не описує. Логуємо
    // порушення — це сигнал, що правило в recipe-generator.md знову поїхало.
    const bad = call.recipe.ing.filter(
      (i: RecipeIng) => 'q' in (i as object) || (i.v != null && typeof i.v !== 'number'),
    );
    if (bad.length) req.log.warn({ bad, title }, 'recipe-ing-schema-violation');

    // Р-3 (design-audit-2): рецепт одразу пишеться чернеткою і отримує адресу.
    // saved_at: null → у бібліотеці не видно; «☆ На потім» стає PATCH saved,
    // тобто з «рятування» перетворюється на «впорядкування». F5 на /recipe/:id
    // більше нічого не губить.
    // TODO(прибирання): чернетки, не збережені й не приготовані за 30 днів,
    // можна чистити — політика узгоджена в звіті, крон буде після деплою.
    const draft_id = randomUUID();
    await repo.saveRecipe({
      id: draft_id,
      owner_id: ctx.user_id,
      origin: 'generated',
      title: call.recipe.t,
      descr: call.recipe.d ?? null,
      character: call.recipe.ch ?? null,
      risk: call.recipe.rk ?? null,
      base_servings: call.recipe.sv ?? 2,
      time_total: call.recipe.tm ?? null,
      nutrition: call.recipe.nu ?? null,
      payload: call.recipe,
      created_at: new Date().toISOString(),
      saved_at: null,
    });

    return { id: draft_id, recipe: call.recipe, meta: call.meta, usage: call.usage };
  });

  // Р-3: адреса рецепта. 404 і для чужого — не підтверджуємо існування id.
  app.get<{ Params: { id: string } }>(
    '/v1/recipes/:id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const row = await repo.getRecipe(req.params.id);
      if (!row || row.owner_id !== user_id) return reply.code(404).send({ error: 'not_found' });
      return {
        id: row.id, origin: row.origin, saved_at: row.saved_at,
        created_at: row.created_at, recipe: row.payload,
      };
    },
  );

  // «На потім» для рецепта, який уже має адресу: не плодимо другий рядок.
  app.patch<{ Params: { id: string }; Body: { saved?: boolean } }>(
    '/v1/recipes/:id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const row = await repo.getRecipe(req.params.id);
      if (!row || row.owner_id !== user_id) return reply.code(404).send({ error: 'not_found' });
      const saved = req.body?.saved === true;
      await repo.setRecipeSaved(row.id, saved ? new Date().toISOString() : null);
      return { id: row.id, saved };
    },
  );

  // ---- Бібліотека рецептів (екран 07 із прототипу) ----------------------
  //
  // До цього рецепт народжувався ТІЛЬКИ в POST /v1/cook-runs: не приготував —
  // зник назавжди. QA-6 намацав це через відчуття «двічі отримав різото й
  // обидва рази втратив». У прототипі екран був, у прод не доїхав.

  // «Лишити на потім» під карткою пропозиції.
  app.post<{ Body: { recipe?: Recipe } }>(
    '/v1/recipes',
    { preHandler: [authenticated(repo), genLimit] },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const recipe = req.body?.recipe;
      if (!recipe?.t || !Array.isArray(recipe.ing)) {
        return reply.code(400).send({ error: 'recipe with t and ing[] required' });
      }
      const now = new Date().toISOString();
      const id = randomUUID();
      await repo.saveRecipe({
        id,
        owner_id: user_id,
        origin: 'generated',
        title: recipe.t,
        descr: recipe.d ?? null,
        character: recipe.ch ?? null,
        risk: recipe.rk ?? null,
        base_servings: recipe.sv ?? 2,
        time_total: recipe.tm ?? null,
        nutrition: recipe.nu ?? null,
        payload: recipe,
        created_at: now,
        saved_at: now,
      });
      return reply.code(201).send({ id });
    },
  );

  // Список із готовністю проти поточної комори: ready / near / far.
  app.get('/v1/recipes', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id, household_id } = requireUser(req);
    const [rows, pantry] = await Promise.all([
      repo.listRecipes(user_id, 50),
      repo.listBatches(household_id),
    ]);
    const recipes = rows.map((r) => {
      const payload = r.payload as { ing?: RecipeIngredient[] } | null;
      const match = matchRecipe(payload?.ing ?? [], pantry);
      return {
        id: r.id,
        title: r.title,
        descr: r.descr,
        character: r.character,
        time_total: r.time_total,
        base_servings: r.base_servings,
        saved_at: r.saved_at,
        cooked_count: r.cooked_count,
        last_cooked_at: r.last_cooked_at,
        payload: r.payload,
        status: match.status,
        have: match.have,
        total: match.total,
        // Назви, не uuid — на екрані має бути «бракує: яйця, бекон».
        missing: match.missing.map((m) => m.n ?? 'інгредієнт'),
        rescues: match.rescues.map((b) => b.label),
      };
    });
    return { recipes };
  });

  // Прибрати зі збережених. Рецепт, який готували, лишається в списку як
  // «готував» — тому не видаляємо рядок, а лише знімаємо saved_at.
  app.delete<{ Params: { id: string } }>(
    '/v1/recipes/:id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const r = await repo.getRecipe(req.params.id);
      if (!r) return reply.code(404).send({ error: 'not_found' });
      if (r.owner_id !== user_id) return reply.code(403).send({ error: 'not_yours' });
      await repo.setRecipeSaved(r.id, null);
      return reply.code(204).send();
    },
  );

  // Публічний read-only рецепт для sharing. Без auth: хто отримав лінк, той бачить.
  // Це саме payload з recipe — той самий, що в БД, без owner/created_at. Плюс на клієнті
  // ми не дозволяємо Cook Mode без логіну — тільки перегляд і "Готуй у себе".
  app.get<{ Params: { id: string } }>(
    '/v1/r/:id',
    { preHandler: publicLimit },
    async (req, reply) => {
      const r = await repo.getRecipe(req.params.id);
      if (!r) return reply.code(404).send({ error: 'not_found' });
      return {
        id: r.id,
        title: r.title,
        recipe: r.payload,
        created_at: r.created_at,
      };
    },
  );
}
