// GET /v1/shopping             → { items }
// POST /v1/shopping/:id/toggle  { checked } → { ok }
// DELETE /v1/shopping/:id       → 204

import type { FastifyInstance } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';

export function shoppingRoutes(app: FastifyInstance, repo: Repo) {
  app.get('/v1/shopping', { preHandler: authenticated(repo) }, async (req) => {
    const { household_id } = requireUser(req);
    const items = await repo.listShoppingItems(household_id);
    return { household_id, count: items.length, items };
  });

  app.post<{
    Params: { id: string };
    Body: { checked?: boolean };
  }>('/v1/shopping/:id/toggle', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { household_id } = requireUser(req);
    const items = await repo.listShoppingItems(household_id);
    const item = items.find((it) => it.id === req.params.id);
    if (!item) return reply.code(404).send({ error: 'shopping item not found' });
    const checked = req.body?.checked ?? !item.checked;
    await repo.toggleShoppingItem(req.params.id, checked);
    return { ok: true, checked };
  });

  app.delete<{ Params: { id: string } }>('/v1/shopping/:id', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { household_id } = requireUser(req);
    const items = await repo.listShoppingItems(household_id);
    const item = items.find((it) => it.id === req.params.id);
    if (!item) return reply.code(404).send({ error: 'shopping item not found' });
    await repo.deleteShoppingItem(req.params.id);
    return reply.code(204).send();
  });
}
