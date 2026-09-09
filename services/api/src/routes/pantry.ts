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
import type { PantryBatch, Repo, Zone, Unit, BatchState, DepletedReason, IntakeCard } from '@kitchen/domain';
import { pantryItemView, newVetoScope, expiryOnOpen, DEPLETED_REASONS } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { BY_KEY } from '@kitchen/catalog/seed';

// Крок Ф1: «з останнього чека» — партії, створені останньою застосованою
// intake-карткою з джерелом-чеком (retail_receipt / chat_receipt). Один запит
// по закритих картках дому за рік; скасована картка чеком не рахується.
//
// Крок Ш1: цей запит і був причиною, чому /v1/pantry віддавався 14 секунд.
// Раніше тут стояв listRecentResolved(limit 300) — SELECT cp.*, тобто `card` і
// `undo_snapshot` (обидва jsonb) трьохсот карток їхали з Neon у застосунок,
// парсились, і з них бралось ОДНЕ поле. Заміряно на копії прод-обсягу: 300
// карток це 1268 kB jsonb і 726–1596 мс, решта обробника — 130 мс на все.
// Тепер із бази виходить один рядок і три поля.
const RECEIPT_WINDOW_DAYS = 365;
export async function lastReceiptBatches(repo: Repo, household_id: string): Promise<{ ids: Set<string>; at: string | null; shop: string | null }> {
  const last = await repo.lastAppliedIntake(household_id, new Date(Date.now() - RECEIPT_WINDOW_DAYS * 86_400_000));
  if (!last) return { ids: new Set(), at: null, shop: null };
  const src = last.source;
  return {
    ids: new Set(last.created_batch_ids),
    at: src.at ?? last.applied_at,
    shop: src.kind === 'retail_receipt' ? src.shop : null,
  };
}

// Крок Ф2: «звідки» для картки — останній чек (з магазином і датою), інший чек
// (за provenance рядка чека), додано рукою (+ Додати), інакше з розмови.
export interface BatchOrigin { kind: 'receipt' | 'manual' | 'chat'; shop: string | null; at: string }
export function batchOrigin(b: PantryBatch, receipt: { ids: Set<string>; at: string | null; shop: string | null }): BatchOrigin {
  if (receipt.ids.has(b.id)) return { kind: 'receipt', shop: receipt.shop, at: receipt.at ?? b.added_at };
  if (b.provenance === 'receipt_line') return { kind: 'receipt', shop: null, at: b.added_at };
  if (b.last_action === 'user_add') return { kind: 'manual', shop: null, at: b.added_at };
  return { kind: 'chat', shop: null, at: b.added_at };
}

function urgencyScore(b: PantryBatch): number {
  // Менше — терміновіше. Відкрите з датою → перше. Свіже — до `expires_at`. Інше — далеко.
  const now = Date.now();
  if (b.state === 'opened' && b.expires_at) return new Date(b.expires_at).getTime() - now;
  if (b.expires_at) return new Date(b.expires_at).getTime() - now + 30 * 86_400_000;
  return Number.MAX_SAFE_INTEGER;
}

export function pantryRoute(app: FastifyInstance, repo: Repo) {
  app.get('/v1/pantry', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id, household_id } = requireUser(req);
    const all = await repo.listBatches(household_id);
    const active = all.filter((b) => b.state !== 'depleted');
    active.sort((a, b) => urgencyScore(a) - urgencyScore(b));
    // Черга Д (№2/№4а): продукти дому — клієнту для «повна назва в
    // інгредієнтах, тільки product у кроках».
    // Пул-3, пошук: до продукту з каталожним ключем доклеюються search_terms
    // (категорії + аліаси) — «сир» знаходить моцарелу/камбоцолу/пармезан,
    // «моцарелла» російською — теж. Кілька слів на продукт, копійки трафіку;
    // сід каталогу на клієнт не тягнемо (то сотні кілобайт).
    const products = (await repo.listProducts(household_id)).map((p) => {
      const cat = p.catalog_key ? BY_KEY.get(p.catalog_key) : undefined;
      return cat
        ? { ...p, search_terms: [...new Set([...cat.categories, ...cat.aliases, cat.name.toLowerCase()])] }
        : p;
    });
    // Раунд 5, крок Ф1: поля для фільтра — верхня категорія каталогу, БЖВ на
    // 100 г з ознакою оцінки, дні до кінця свіжості, останній чек, «не їм /
    // не можна» тим самим збігом, що ⚠ у промпті, вік партії.
    const [vetoIndex, receipt] = await Promise.all([repo.getVetoIndex(user_id), lastReceiptBatches(repo, household_id)]);
    const byId = new Map(products.map((p) => [p.id, p]));
    const now = Date.now();
    // Крок Ш3: один кеш footprint на весь прохід. Сотня партій дає десятки
    // однакових текстів («молоко» різних партій, назва тієї самої позиції
    // каталогу), і кожен із них інакше йшов би в resolveLabel заново.
    const scope = newVetoScope();
    const batches = active.map((b) => ({ ...b, ...pantryItemView(b, b.product_id ? byId.get(b.product_id) : undefined, vetoIndex, receipt.ids, now, scope), origin: batchOrigin(b, receipt) }));
    return {
      household_id,
      count: active.length,
      batches,
      products,
      last_receipt_at: receipt.at,
    };
  });

  const ZONES: Zone[] = ['dry', 'fridge', 'freezer', 'fresh', 'spices', 'drinks'];
  const UNITS: Unit[] = ['g', 'ml', 'pcs', 'pack'];
  const STATES: BatchState[] = ['sealed', 'opened', 'depleted'];

  // Пряме створення партії — юзер знає, що додає. Модель у бріфі §01 «не пише в стан
  // напряму», але це не про людину. Тут — той самий шлях, що intake_diff add op,
  // тільки без картки-підтвердження.
  app.post<{
    Body: {
      label: string;
      value?: number | null;
      unit?: Unit | null;
      zone?: Zone;
    };
  }>('/v1/pantry', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id, household_id } = requireUser(req);
    const label = (req.body.label ?? '').trim();
    if (!label) return reply.code(400).send({ error: 'label_required' });
    const value = req.body.value ?? null;
    if (value != null && (typeof value !== 'number' || value < 0)) {
      return reply.code(400).send({ error: 'value_negative' });
    }
    const unit = req.body.unit ?? null;
    if (unit != null && !UNITS.includes(unit)) return reply.code(400).send({ error: 'unit_invalid' });
    const zone = req.body.zone ?? 'dry';
    if (!ZONES.includes(zone)) return reply.code(400).send({ error: 'zone_invalid' });

    const { randomUUID } = await import('node:crypto');
    const id = randomUUID();
    const now = new Date().toISOString();
    await repo.insertBatch({
      id,
      household_id,
      catalog_key: null,
      label,
      zone,
      value,
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
      last_action: 'user_add',
    });
    const batch = await repo.getBatch(id);
    return reply.code(201).send({ batch });
  });

  app.patch<{
    Params: { id: string };
    Body: {
      label?: string;
      value?: number | null;
      unit?: Unit | null;
      zone?: Zone;
      state?: BatchState;
      /** Крок Ф2: «свіже до» з картки — дата або null («без терміну»). */
      expires_at?: string | null;
      /** А1: чому партія зникла. Має сенс лише разом зі `state: 'depleted'`. */
      reason?: DepletedReason;
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
    if ('expires_at' in req.body) {
      const e = req.body.expires_at;
      if (e != null && (typeof e !== 'string' || Number.isNaN(new Date(e).getTime()))) return reply.code(400).send({ error: 'expires_invalid' });
      patch.expires_at = e == null ? null : new Date(e).toISOString();
    }
    // А1: перелік причин закритий — вільний текст у метрику не потрапляє.
    const reason = req.body.reason;
    if (reason !== undefined && !DEPLETED_REASONS.includes(reason)) {
      return reply.code(400).send({ error: 'reason_invalid' });
    }
    if ('state' in req.body) {
      if (!STATES.includes(req.body.state!)) return reply.code(400).send({ error: 'state_invalid' });
      patch.state = req.body.state;
      if (req.body.state === 'opened' && !batch.opened_at) {
        patch.opened_at = new Date().toISOString();
        // А2: «Позначити відкритою» досі ставило тільки opened_at — годинник
        // «вжити до» з картки не стартував узагалі, на відміну від тих самих
        // слів у чаті. Менше з двох: відкриття скорочує строк, не подовжує.
        patch.expires_at = expiryOnOpen(
          'expires_at' in patch ? patch.expires_at ?? null : batch.expires_at,
          batch.best_before_opened_days,
        );
      }
      if (req.body.state === 'depleted') {
        patch.depleted_at = new Date().toISOString();
        // А1: причина — тільки якщо її передали. Дефолту немає навмисно:
        // вигадане значення зробило б метрику брехливою, а не відсутньою.
        if (reason !== undefined) patch.depleted_reason = reason;
      }
      if (req.body.state === 'sealed') {
        patch.opened_at = null;
        patch.depleted_at = null;
        // Партія повернулась у комору жива — причина йде за станом, інакше
        // вона порахується вдруге при наступному списанні.
        patch.depleted_reason = null;
      }
    }

    await repo.updateBatch(batch.id, patch);
    const updated = await repo.getBatch(batch.id);
    return { updated: true, batch: updated };
  });

  // Прибрати = м'яке депляціонування. Так само як «зʼїли/вилили» — партія зникає
  // зі списку, але лишається в історії. Ніякого hard-delete через API поки що.
  app.delete<{ Params: { id: string }; Body?: { reason?: DepletedReason } }>(
    '/v1/pantry/:id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id, household_id } = requireUser(req);
      const batch = await repo.getBatch(req.params.id);
      if (!batch) return reply.code(404).send({ error: 'not_found' });
      if (batch.household_id !== household_id) return reply.code(403).send({ error: 'not_yours' });
      // А1: той самий закритий перелік, що в PATCH. Причини немає — лишаємо
      // порожньою: «прибрали» ще не означає «зіпсувалось».
      const reason = req.body?.reason;
      if (reason !== undefined && !DEPLETED_REASONS.includes(reason)) {
        return reply.code(400).send({ error: 'reason_invalid' });
      }
      await repo.updateBatch(batch.id, {
        state: 'depleted',
        depleted_at: new Date().toISOString(),
        ...(reason !== undefined ? { depleted_reason: reason } : {}),
        last_by: user_id,
        last_action: 'user_delete',
      });
      return { deleted: true };
    },
  );
}
