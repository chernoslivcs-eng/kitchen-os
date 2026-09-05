// GET /v1/session/today → { session, messages }
// Гідратує стрічку при відкритті вкладки. За замовчуванням: найсвіжіша сесія дня.
// POST /v1/session → { session } — свіжа сесія на сьогодні; попередні лишаються
// в БД як історія, але не завантажуються автоматично.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Repo, Recipe, RecipeLinkCard, OnboardingCard } from '@kitchen/domain';
import { ONBOARDING_GREETING, isProfileEmpty } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { localDay } from '../local-day.js';

export interface SessionRouteOpts {
  // Раунд 4, крок 7: картка «Про тебе» видається тільки під PROFILE_V2.
  profileV2?: boolean;
}

export function sessionRoutes(app: FastifyInstance, repo: Repo, opts: SessionRouteOpts = {}) {
  app.get('/v1/session/today', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id } = requireUser(req);
    const session = await repo.getOrCreateSessionForDay(user_id, localDay());
    // П.8 pre-deploy: recipe_link несе повний рецепт у кожному повідомленні —
    // без кепа стара сесія важить мегабайти. 200 останніх вистачає будь-якому
    // екрану; глибша історія — окрема задача пагінації, якщо знадобиться.
    let messages = (await repo.listMessages(session.id)).slice(-200);

    // Крок 7 (§4 контракту): перша розмова, усі сім полів порожні, картка ще
    // не видавалась → вітання + картка в одному повідомленні, без моделі.
    // Позначка на користувачі — щоб рівно один раз, а не раз на сесію.
    if (opts.profileV2) {
      const user = await repo.getUser(user_id);
      if (user && !user.profile_onboarding_at && isProfileEmpty(await repo.getProfileText(user_id))) {
        const now = new Date().toISOString();
        const message = {
          id: randomUUID(), session_id: session.id, role: 'assistant' as const,
          text: ONBOARDING_GREETING, card: { type: 'onboarding' } as OnboardingCard,
          applied: 0, created_at: now,
        };
        await repo.saveMessage(message);
        await repo.touchUser(user_id, 'profile_onboarding_at', now);
        messages = [...messages, message];
      }
    }
    return { session, messages };
  });

  // Правки №10/11: {recipe_id} → сесія, у якій рецепт лежить першим ходом
  // (рецепт — хід розмови, не екран). Сесія-близнюк — рівно один recipe_link
  // цього ж рецепта і нічого більше — реюзається: подвійний клік по рецепту
  // в бібліотеці не плодить сміття у списку сесій.
  app.post<{ Body: { recipe_id?: string } }>(
    '/v1/session',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const recipe_id = req.body?.recipe_id;
      if (!recipe_id) {
        const session = await repo.createFreshSession(user_id, localDay());
        return { session, messages: [] };
      }

      const row = await repo.getRecipe(recipe_id);
      if (!row || row.owner_id !== user_id) return reply.code(404).send({ error: 'not_found' });

      // Близнюк: найсвіжіша сесія, що складається рівно з цього рецепта.
      const recent = await repo.listSessionsForUser(user_id, 10);
      for (const s of recent) {
        if (s.message_count !== 1) continue;
        const msgs = await repo.listMessages(s.id);
        const only = msgs[0];
        if (only?.card?.type === 'recipe_link' && (only.card as RecipeLinkCard).recipe_id === recipe_id) {
          return { session: s, messages: msgs };
        }
      }

      const session = await repo.createFreshSession(user_id, localDay());
      const message = {
        id: randomUUID(), session_id: session.id, role: 'assistant' as const,
        text: null,
        card: {
          type: 'recipe_link', recipe_id, title: row.title, recipe: row.payload as Recipe,
        } as RecipeLinkCard,
        applied: 0, created_at: new Date().toISOString(),
      };
      await repo.saveMessage(message);
      await repo.setSessionTitle(session.id, row.title);
      return { session: { ...session, title: row.title }, messages: [message] };
    },
  );

  // GET /v1/sessions → останні N сесій юзера (для «Історія чатів»).
  // GET /v1/sessions/:id → конкретна сесія + її повідомлення.
  app.get('/v1/sessions', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id } = requireUser(req);
    const sessions = await repo.listSessionsForUser(user_id, 30);
    return { sessions };
  });

  app.get<{ Params: { id: string } }>(
    '/v1/sessions/:id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const session = await repo.getSession(req.params.id);
      if (!session) return reply.code(404).send({ error: 'not_found' });
      if (session.user_id !== user_id) return reply.code(403).send({ error: 'not_yours' });
      const messages = (await repo.listMessages(session.id)).slice(-200);
      return { session, messages };
    },
  );

  // Пул-4 №1: видалити сесію. Повідомлення й незакриті картки зникають,
  // журнал лишається (cook_run.session_id відвʼязується). Жорстко і свідомо:
  // сесія — розмова, не запас.
  app.delete<{ Params: { id: string } }>(
    '/v1/sessions/:id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const session = await repo.getSession(req.params.id);
      if (!session) return reply.code(404).send({ error: 'not_found' });
      if (session.user_id !== user_id) return reply.code(403).send({ error: 'not_yours' });
      await repo.deleteSession(session.id);
      return { deleted: true };
    },
  );
}
