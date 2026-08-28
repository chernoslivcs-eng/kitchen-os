import type { FastifyInstance } from 'fastify';
import { applyCard, undoCard, type Repo } from '@kitchen/domain';

export function cardsRoutes(app: FastifyInstance, repo: Repo) {
  // POST /v1/cards/:id/apply  { selected: [op_index], user_id }
  //   → { applied, undo_token, already }
  app.post<{
    Params: { id: string };
    Body: { selected?: number[]; user_id: string };
  }>('/v1/cards/:id/apply', async (req, reply) => {
    const { user_id, selected } = req.body ?? {};
    if (!user_id) return reply.code(400).send({ error: 'user_id required' });
    try {
      const r = await applyCard(repo, req.params.id, selected ?? [], user_id);
      return r;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'forbidden') return reply.code(403).send({ error: msg });
      if (msg.startsWith('card not found')) return reply.code(404).send({ error: msg });
      return reply.code(409).send({ error: msg });
    }
  });

  // POST /v1/cards/:id/undo  { undo_token, user_id }
  //   → { undone, already }
  app.post<{
    Params: { id: string };
    Body: { undo_token: string; user_id: string };
  }>('/v1/cards/:id/undo', async (req, reply) => {
    const { user_id, undo_token } = req.body ?? {};
    if (!user_id || !undo_token) return reply.code(400).send({ error: 'user_id and undo_token required' });
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
