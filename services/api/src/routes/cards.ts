import type { FastifyInstance } from 'fastify';
import { applyCard, undoCard, type Repo } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';

export function cardsRoutes(app: FastifyInstance, repo: Repo) {
  // POST /v1/cards/:id/apply  { selected?: [op_index] }
  //   → { applied, undo_token, already }
  app.post<{
    Params: { id: string };
    Body: { selected?: number[] };
  }>('/v1/cards/:id/apply', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id } = requireUser(req);
    try {
      const r = await applyCard(repo, req.params.id, req.body?.selected ?? [], user_id);
      return r;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'forbidden') return reply.code(403).send({ error: msg });
      if (msg.startsWith('card not found')) return reply.code(404).send({ error: msg });
      return reply.code(409).send({ error: msg });
    }
  });

  // POST /v1/cards/:id/undo  { undo_token }
  //   → { undone, already }
  app.post<{
    Params: { id: string };
    Body: { undo_token: string };
  }>('/v1/cards/:id/undo', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id } = requireUser(req);
    const { undo_token } = req.body ?? ({} as any);
    if (!undo_token) return reply.code(400).send({ error: 'undo_token required' });
    try {
      const r = await undoCard(repo, req.params.id, undo_token, user_id);
      return r;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'forbidden') return reply.code(403).send({ error: msg });
      if (msg.startsWith('card not found')) return reply.code(404).send({ error: msg });
      return reply.code(409).send({ error: msg });
    }
  });
}
