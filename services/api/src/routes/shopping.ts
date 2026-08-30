// GET /v1/shopping             → { items }
// POST /v1/shopping/:id/toggle  { checked } → { ok }
// DELETE /v1/shopping/:id       → 204
// POST /v1/shopping/unpack      → { created: n } — «розібрати куплене»: усе позначене
//                                 як checked стає партіями в коморі й вибуває зі списку.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PantryBatch, Repo, Zone, Unit } from '@kitchen/domain';
import { resolveLabelToKey, resolveLabelToZone } from '@kitchen/catalog';
import { authenticated, requireUser } from '../middleware/session.js';

export function shoppingRoutes(app: FastifyInstance, repo: Repo) {
  app.get('/v1/shopping', { preHandler: authenticated(repo) }, async (req) => {
    const { household_id } = requireUser(req);
    const items = await repo.listShoppingItems(household_id);
    // DA2-31: один елемент навігації показував два різні числа — сервер
    // рахував усі позиції, екран списку тільки некуплені. Канон: count =
    // «ще треба купити», total — для мета-рядка «2 / 3».
    const unchecked = items.filter((i) => !i.checked).length;
    return { household_id, count: unchecked, total: items.length, items };
  });

  // Бриф-3 п.8: «+ у список» інлайн на бракуючому інгредієнті. До цього
  // (QA7-01) позицію руками було не додати взагалі — тільки карткою моделі.
  // Правило продукту не порушено: пише людина через інтерфейс, не модель.
  app.post<{ Body: { label?: string; v?: number; u?: string; reason?: string } }>(
    '/v1/shopping',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id, household_id } = requireUser(req);
      const label = req.body?.label?.trim();
      if (!label) return reply.code(400).send({ error: 'label required' });
      // Дубль за назвою — не помилка і не друга позиція.
      const existing = (await repo.listShoppingItems(household_id))
        .find((i) => i.label.trim().toLowerCase() === label.toLowerCase());
      if (existing) return reply.code(200).send({ item: existing, already: true });
      const item = {
        id: randomUUID(),
        household_id,
        label,
        reason: req.body?.reason?.trim() || null,
        value: typeof req.body?.v === 'number' && req.body.v > 0 ? req.body.v : null,
        unit: req.body?.u ?? null,
        zone: resolveLabelToZone(label),
        checked: false,
        added_by: user_id,
        source: 'user' as const,
        created_at: new Date().toISOString(),
      };
      await repo.insertShoppingItem(item);
      return reply.code(201).send({ item });
    },
  );

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
      // QA6-06: коли зони немає, питаємо каталог, а не кладемо все в `dry`.
      // Молоко переїжджало в комору замість холодильника.
      const catalogKey = resolveLabelToKey(it.label);
      const zone = (it.zone && (ZONES as string[]).includes(it.zone))
        ? (it.zone as Zone)
        : (resolveLabelToZone(it.label) ?? 'dry');
      const batch: PantryBatch = {
        id: randomUUID(),
        household_id,
        catalog_key: catalogKey,
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
