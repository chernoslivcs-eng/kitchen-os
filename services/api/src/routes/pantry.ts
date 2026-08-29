// GET /v1/pantry
//   Партії активного дому, як їх бачить фронт: без chat-контексту.
//   depleted тут НЕ повертаються — вони живуть у «кошику закінченого» (окремий ендпоінт,
//   якщо треба буде UI для відновлення; наразі не блокує).
//
//   Порядок: за терміновістю (opened + expires_at → першими), потім за added_at.
//   Це те, що фронт хоче показати одразу, і те, що ловить головну обіцянку продукту:
//   те, що псується — на видноті.
//
// PATCH /v1/pantry/:id, DELETE /v1/pantry/:id
//   Пряма ручна корекція. Модель у бріфі §01 «не пише в стан напряму» — це не про юзера.
//   Юзер каже «моцарела була 500 г, не 250» → відкриває деталі, редагує. Так само коли
//   партія випадково додалась не в ту зону (морозилку замість холодильника). Аудит
//   лишається в last_by/last_action.

import type { FastifyInstance } from 'fastify';
import type { PantryBatch, Repo, Zone, Unit, BatchState } from '@kitchen/domain';
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

  const ZONES: Zone[] = ['dry', 'fridge', 'freezer', 'fresh', 'spices', 'drinks'];
  const UNITS: Unit[] = ['g', 'ml', 'pcs', 'pack'];
  const STATES: BatchState[] = ['sealed', 'opened', 'depleted'];

  app.patch<{
    Params: { id: string };
    Body: {
      label?: string;
      value?: number | null;
      unit?: Unit | null;
      zone?: Zone;
      state?: BatchState;
    };
  }>('/v1/pantry/:id', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id, household_id } = requireUser(req);
    const batch = await repo.getBatch(req.params.id);
    if (!batch) return reply.code(404).send({ error: 'not_found' });
    if (batch.household_id !== household_id) return reply.code(403).send({ error: 'not_yours' });

    const patch: Partial<PantryBatch> = {
      last_by: user_id,
      last_action: 'user_edit',
    };

    if ('label' in req.body) {
      const s = (req.body.label ?? '').trim();
      if (!s) return reply.code(400).send({ error: 'label_empty' });
      patch.label = s;
    }
    if ('value' in req.body) {
      const v = req.body.value;
      if (v != null && (typeof v !== 'number' || v < 0)) return reply.code(400).send({ error: 'value_negative' });
      patch.value = v ?? null;
    }
    if ('unit' in req.body) {
      const u = req.body.unit;
      if (u != null && !UNITS.includes(u)) return reply.code(400).send({ error: 'unit_invalid' });
      patch.unit = u ?? null;
    }
    if ('zone' in req.body) {
      if (!ZONES.includes(req.body.zone!)) return reply.code(400).send({ error: 'zone_invalid' });
      patch.zone = req.body.zone;
    }
    if ('state' in req.body) {
      if (!STATES.includes(req.body.state!)) return reply.code(400).send({ error: 'state_invalid' });
      patch.state = req.body.state;
      if (req.body.state === 'opened' && !batch.opened_at) patch.opened_at = new Date().toISOString();
      if (req.body.state === 'depleted') patch.depleted_at = new Date().toISOString();
      if (req.body.state === 'sealed') { patch.opened_at = null; patch.depleted_at = null; }
    }

    await repo.updateBatch(batch.id, patch);
    const updated = await repo.getBatch(batch.id);
    return { updated: true, batch: updated };
  });

  // Прибрати = м'яке депляціонування. Так само як «зʼїли/вилили» — партія зникає
  // зі списку, але лишається в історії. Ніякого hard-delete через API поки що.
  app.delete<{ Params: { id: string } }>(
    '/v1/pantry/:id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id, household_id } = requireUser(req);
      const batch = await repo.getBatch(req.params.id);
      if (!batch) return reply.code(404).send({ error: 'not_found' });
      if (batch.household_id !== household_id) return reply.code(403).send({ error: 'not_yours' });
      await repo.updateBatch(batch.id, {
        state: 'depleted',
        depleted_at: new Date().toISOString(),
        last_by: user_id,
        last_action: 'user_delete',
      });
      return { deleted: true };
    },
  );
}
