import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { applyCard, undoCard, dismissCard, type Repo, type Unit } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { WRITEOFF_CARD_REPLY, FEEDBACK_PROMPT } from '../post-cook.js';

export function cardsRoutes(app: FastifyInstance, repo: Repo) {
  // Черга Г (№3): панель ОЧІКУЮТЬ дивиться на всі незакриті картки дому.
  // Віддаємо лише те, що панелі треба: тип, сесію (для переходу) і час.
  app.get('/v1/cards/pending', { preHandler: authenticated(repo) }, async (req) => {
    const { household_id } = requireUser(req);
    // proposal — не рішення, а меню моменту: його не «застосовують», тож у
    // черзі рішень воно висіло б вічно. Показуємо тільки дійові картки.
    const open = (await repo.listOpenPending(household_id, 40))
      .filter((pc) => pc.card.type !== 'proposal')
      .slice(0, 12);
    return {
      cards: open.map((pc) => ({
        id: pc.id,
        type: pc.card.type,
        session_id: pc.session_id,
        created_at: pc.created_at,
      })),
    };
  });

  // POST /v1/cards/:id/apply  { selected?: [op_index] }
  //   → { applied, undo_token, already, followup? }
  app.post<{
    Params: { id: string };
    Body: { none?: boolean; selected?: number[] };
  }>('/v1/cards/:id/apply', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id } = requireUser(req);
    try {
      // Раунд 4 §4: {none:true} — «Нічого такого» на онбординг-картці ban.
      const r = await applyCard(repo, req.params.id, req.body?.selected ?? [], user_id,
        { none: req.body?.none === true });

      // Промах операції: ціль не знайдено, стан не змінився. Логуємо, бо
      // частоти цього ми не знаємо — а без числа неможливо вирішити, чи це
      // взагалі проблема в житті, чи лише в підстроєному випадку.
      if (r.missed?.length) {
        req.log.warn({ user_id, card_id: req.params.id, missed: r.missed }, 'intake-op-missed');
      }
      // Правка №6: застосована пост-кук картка списання продовжує розмову
      // детермінованим «Як вийшло?» (0 токенів). Впізнаємо її за точним
      // службовим текстом повідомлення-носія.
      if (!r.already) {
        const msg = await repo.getMessage(req.params.id);
        if (msg?.card?.type === 'intake_diff' && msg.text === WRITEOFF_CARD_REPLY) {
          await repo.saveMessage({
            id: randomUUID(), session_id: msg.session_id, role: 'assistant',
            text: FEEDBACK_PROMPT, card: null, applied: 0, created_at: new Date().toISOString(),
          });
          return { ...r, followup: FEEDBACK_PROMPT };
        }
      }
      return r;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'forbidden') return reply.code(403).send({ error: msg });
      if (msg.startsWith('card not found')) return reply.code(404).send({ error: msg });
      return reply.code(409).send({ error: msg });
    }
  });

  // 01.09 картка v2: «уточнити» на невпізнаному рядку чека — степер +
  // одиниця, тап «ок» переносить рядок із source.unmatched у ops, тим
  // самим шляхом, що впізнане каталогом. Один список, одна дія — не
  // окремий потік «додати руками». Пишемо і в pending (те, що реально
  // читає applyCard), і в message (те, що рендериться після F5) — та
  // сама пара сховищ, що cart-swap/cart-add-alt тримають для cart-карток.
  app.post<{
    Params: { id: string };
    Body: { unmatched_index?: number; value?: number; unit?: Unit };
  }>('/v1/cards/:id/clarify-line', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id } = requireUser(req);
    const { unmatched_index, value, unit } = req.body ?? {};
    if (unmatched_index == null) return reply.code(400).send({ error: 'unmatched_index required' });

    const pc = await repo.getPending(req.params.id);
    if (!pc) return reply.code(404).send({ error: `card not found: ${req.params.id}` });
    if (pc.user_id !== user_id) return reply.code(403).send({ error: 'forbidden' });
    if (pc.applied_at || pc.undone_at) return reply.code(409).send({ error: 'card already closed' });

    const card = pc.card;
    // Звужуємо саме до чека МЕРЕЖІ: unmatched існує тільки в нього. У чека
    // з чату розкладки каталогу немає — там нічого «уточнювати», бо нема
    // списку невпізнаних. Без цієї перевірки союз IntakeSource не
    // компілювався б, і це правильно: тип показав, що маршрут мовчки
    // припускав один рід джерела з двох.
    if (card.type !== 'intake_diff' || card.source?.kind !== 'retail_receipt') {
      return reply.code(409).send({ error: 'not a receipt card' });
    }
    const source = card.source;
    const line = source.unmatched[unmatched_index];
    if (!line) return reply.code(409).send({ error: 'unmatched_index out of range' });

    source.unmatched = source.unmatched.filter((_, i) => i !== unmatched_index);
    card.ops = [...card.ops, {
      op: 'add', label: line.name,
      value: value ?? line.quantity, unit: unit ?? (line.unit as Unit | undefined),
      confidence: 1, evidence: 'user_clarified',
    }];

    await repo.updatePending(req.params.id, { card });
    await repo.updateMessageCard(req.params.id, card);
    return { card };
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

  // POST /v1/cards/:id/dismiss  (без тіла)
  //   → { dismissed, already }
  // Аудит раунд 3, крок 1: «Ні» на pending-картці, тепер живе в БД — не
  // лише в React-стані вкладки. Той самий auth/scope, що в undo:
  // user_id картки, не household — картка належить людині, яка її отримала.
  app.post<{ Params: { id: string } }>(
    '/v1/cards/:id/dismiss',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      try {
        const r = await dismissCard(repo, req.params.id, user_id);
        return r;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === 'forbidden') return reply.code(403).send({ error: msg });
        if (msg.startsWith('card not found')) return reply.code(404).send({ error: msg });
        return reply.code(409).send({ error: msg });
      }
    },
  );
}
