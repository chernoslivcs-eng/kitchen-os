// GET /v1/session/today → { session, messages }
// Гідратує стрічку при відкритті вкладки. Сесія — на день, на юзера.
// Одна людина = одна колонка чату на добу.

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
}
