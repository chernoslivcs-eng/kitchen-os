// GET /v1/shopping             → { items }
// POST /v1/shopping/:id/toggle  { checked } → { ok }
// DELETE /v1/shopping/:id       → 204
// POST /v1/shopping/unpack      → { created: n } — «розібрати куплене»: усе позначене
//                                 як checked стає партіями в коморі й вибуває зі списку.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PantryBatch, Repo, Zone, Unit } from '@kitchen/domain';
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

  const UNITS: Unit[] = ['g', 'ml', 'pcs', 'pack'];
  const ZONES: Zone[] = ['dry', 'fridge', 'freezer', 'fresh', 'spices', 'drinks'];

  app.post('/v1/shopping/unpack', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id, household_id } = requireUser(req);
    const items = await repo.listShoppingItems(household_id);
    const checked = items.filter((it) => it.checked);
    const now = new Date().toISOString();
    let created = 0;
    for (const it of checked) {
      // Одиниці й зона в shopping_item — вільний string. Приводимо до enum, або null.
      const unit = (it.unit && (UNITS as string[]).includes(it.unit)) ? (it.unit as Unit) : null;
      const zone = (it.zone && (ZONES as string[]).includes(it.zone)) ? (it.zone as Zone) : 'dry';
      const batch: PantryBatch = {
        id: randomUUID(),
        household_id,
        catalog_key: null,
        label: it.label,
        zone,
        value: it.value,
        unit,
        state: 'sealed',
        opened_at: null,
        expires_at: null,
        best_before_opened_days: null,
        added_at: now,
        depleted_at: null,
        confidence: 1,
        provenance: 'user_statement',
        staple: false,
        last_by: user_id,
        last_action: 'unpack',
      };
      await repo.insertBatch(batch);
      await repo.deleteShoppingItem(it.id);
      created++;
    }
    return { created };
  });
}
