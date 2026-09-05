// Раунд 4, крок 7: пропуск панелі в картці «Про тебе». Стан заповнених
// панелей — profile_text.status (той самий PATCH /v1/profile/:key, що на
// сторінці); тут лише «Пропустити» — у самій картці, щоб перезавантаження не
// повертало панель у «ще не відповідали».

import type { FastifyInstance } from 'fastify';
import { PROFILE_FIELD_KEYS, type Repo, type OnboardingCard, type ProfileFieldKey } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';

export function onboardingRoutes(app: FastifyInstance, repo: Repo) {
  app.patch<{ Params: { message_id: string }; Body: { skip?: unknown } }>(
    '/v1/onboarding/:message_id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const key = req.body?.skip;
      if (typeof key !== 'string' || !(PROFILE_FIELD_KEYS as readonly string[]).includes(key)) {
        return reply.code(400).send({ error: 'bad_key' });
      }
      const msg = await repo.getMessage(req.params.message_id);
      if (!msg || msg.card?.type !== 'onboarding') return reply.code(404).send({ error: 'not_found' });
      const session = await repo.getSession(msg.session_id);
      if (!session || session.user_id !== user_id) return reply.code(404).send({ error: 'not_found' });
      const card = msg.card as OnboardingCard;
      const skipped = [...new Set([...(card.skipped ?? []), key as ProfileFieldKey])];
      const next: OnboardingCard = { ...card, skipped };
      await repo.updateMessageCard(msg.id, next);
      return { card: next };
    },
  );
}
