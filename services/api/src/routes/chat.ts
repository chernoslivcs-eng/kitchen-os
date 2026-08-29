import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { callChat, callAttachmentParse, type AttachmentPayload } from '../model.js';
import { createPending, type Repo } from '@kitchen/domain';
import type { AttachmentStore } from '../attachment-store.js';
import { authenticated, requireUser } from '../middleware/session.js';
import { recordUsage } from '../usage.js';

// POST /v1/chat
//   Тіло: { session_id, text, attachments?: [{id}] }
//   user_id/household_id беруться з cookie-сесії, не з тіла.
//   →
//   { reply, card, card_id, raw_kind?, usage, meta }
//
// Побічних ефектів на комору НЕ застосовує. Картка йде як пропозиція,
// клієнт натискає apply. Це те саме правило, що й у прототипі:
// модель ніколи не пише в стан напряму.

export function chatRoute(app: FastifyInstance, repo: Repo, store: AttachmentStore) {
  app.post<{
    Body: {
      session_id?: string;
      text?: string;
      attachments?: { id: string }[];
    };
  }>('/v1/chat', { preHandler: authenticated(repo) }, async (req, reply) => {
    const ctx = requireUser(req);
    const { user_id, household_id } = ctx;
    const { text, attachments } = req.body ?? {};
    if (!text && !attachments?.length) {
      return reply.code(400).send({ error: 'text or attachments required' });
    }

    if (attachments?.length) {
      const payloads: AttachmentPayload[] = [];
      for (const { id } of attachments) {
        const rec = await repo.getAttachment(id);
        if (!rec) return reply.code(404).send({ error: `attachment not found: ${id}` });
        if (rec.user_id !== user_id) return reply.code(403).send({ error: `forbidden attachment: ${id}` });
        const { buffer, content_type } = await store.get(rec.url);
        payloads.push({ kind: rec.kind, buffer, content_type, hint: rec.hint ?? undefined });
      }
      const started = Date.now();
      const call = await callAttachmentParse(payloads);
      await recordUsage(repo, ctx, 'attachment_parse', call.meta, call.usage, started);
      const card_id = call.card ? randomUUID() : null;
      if (call.card && card_id) {
        await createPending(repo, { message_id: card_id, household_id, user_id, card: call.card });
      }
      return {
        reply: call.reply,
        card: call.card,
        card_id,
        raw_kind: call.raw_kind,
        usage: call.usage,
        meta: call.meta,
      };
    }

    const pantry = await repo.listBatches(household_id);
    // Онбординг: stage 1, поки в коморі порожньо; stage 2, коли комора наповнена,
    // а профіль ще не має відповіді на «алергії/дім/традиції» (як проксі використовуємо
    // порожні три блоки — щойно щось з'явиться, стадія 2 гасне).
    let stage: 1 | 2 | undefined;
    const activeBatches = pantry.filter((b) => b.state !== 'depleted').length;
    if (activeBatches === 0) {
      stage = 1;
    } else if (activeBatches >= 3) {
      const profile = await repo.getProfile(user_id);
      const empty = !profile
        || (profile.allergies.length === 0 && profile.wishes.length === 0 && profile.antipatterns.length === 0);
      if (empty) stage = 2;
    }
    const started = Date.now();
    const call = await callChat({
      user_id, session_id: req.body?.session_id ?? '', text: text ?? '', pantry, stage,
    });
    await recordUsage(repo, ctx, 'chat', call.meta, call.usage, started);
    const card_id = call.card ? randomUUID() : null;
    if (call.card && card_id) {
      await createPending(repo, { message_id: card_id, household_id, user_id, card: call.card });
    }
    return {
      reply: call.reply,
      card: call.card,
      card_id,
      usage: call.usage,
      meta: call.meta,
    };
  });
}
