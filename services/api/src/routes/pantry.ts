// GET /v1/pantry
//   Партії активного дому, як їх бачить фронт: без chat-контексту.
//   depleted тут НЕ повертаються — вони живуть у «кошику закінченого» (окремий ендпоінт,
//   якщо треба буде UI для відновлення; наразі не блокує).
//
//   Порядок: за терміновістю (opened + expires_at → першими), потім за added_at.
//   Це те, що фронт хоче показати одразу, і те, що ловить головну обіцянку продукту:
//   те, що псується — на видноті.

import type { FastifyInstance } from 'fastify';
import type { PantryBatch, Repo } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';

function urgencyScore(b: PantryBatch): number {
  // Менше — терміновіше. Відкрите з датою → перше. Свіже — до `expires_at`. Інше — далеко.
  const now = Date.now();
  if (b.state === 'opened' && b.expires_at) return new Date(b.expires_at).getTime() - now;
  if (b.expires_at) return new Date(b.expires_at).getTime() - now + 30 * 86_400_000;
  return Number.MAX_SAFE_INTEGER;
}

export function pantryRoute(app: FastifyInstance, repo: Repo) {
  app.get('/v1/pantry', { preHandler: authenticated(repo) }, async (req) => {
    const { household_id } = requireUser(req);
    const all = await repo.listBatches(household_id);
    const active = all.filter((b) => b.state !== 'depleted');
    active.sort((a, b) => urgencyScore(a) - urgencyScore(b));
    return {
      household_id,
      count: active.length,
      batches: active,
    };
  });
}
