import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { applyCard, undoCard, type Repo } from '@kitchen/domain';
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
    Body: { selected?: number[] };
  }>('/v1/cards/:id/apply', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id } = requireUser(req);
    try {
      const r = await applyCard(repo, req.params.id, req.body?.selected ?? [], user_id);
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
