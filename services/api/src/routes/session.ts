// GET /v1/session/today → { session, messages }
// Гідратує стрічку при відкритті вкладки. За замовчуванням: найсвіжіша сесія дня.
// POST /v1/session → { session } — свіжа сесія на сьогодні; попередні лишаються
// в БД як історія, але не завантажуються автоматично.

import type { FastifyInstance } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function sessionRoutes(app: FastifyInstance, repo: Repo) {
  app.get('/v1/session/today', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id } = requireUser(req);
    const session = await repo.getOrCreateSessionForDay(user_id, today());
    const messages = await repo.listMessages(session.id);
    return { session, messages };
  });

  app.post('/v1/session', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id } = requireUser(req);
    const session = await repo.createFreshSession(user_id, today());
    return { session, messages: [] };
  });
}
