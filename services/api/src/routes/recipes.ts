// POST /v1/recipes/generate  { title, context? }
//   → { recipe, meta, usage }
// Персистенції рецепта поки нема — фронт тримає його в стані React-Router до
// перезавантаження. Коли зʼявиться таблиця recipe і CookRun — додамо GET/POST /v1/recipes/:id.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { callRecipe } from '../model.js';
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
      (i) => 'q' in (i as object) || (i.v != null && typeof i.v !== 'number'),
    );
    if (bad.length) req.log.warn({ bad, title }, 'recipe-ing-schema-violation');

    return { recipe: call.recipe, meta: call.meta, usage: call.usage };
  });

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
