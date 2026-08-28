import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { callChat, callAttachmentParse, type AttachmentPayload } from '../model.js';
import { createPending, type Repo } from '@kitchen/domain';
import type { AttachmentStore } from '../attachment-store.js';

// POST /v1/chat
//   { session_id, user_id, household_id, text, attachments?: [{id}] }
//   →
//   { reply, card, card_id, raw_kind?, usage, meta }
//
// Побічних ефектів на комору НЕ застосовує. Картка йде як пропозиція,
// клієнт натискає apply. Це те саме правило, що й у прототипі:
// модель ніколи не пише в стан напряму.
//
// Якщо attachments[] є — маршрутизуємо на attachment_parse (temperature 0), а не chat.
// Це відповідає розкладці реєстру викликів у 01-product.html § «Реєстр викликів».

export function chatRoute(app: FastifyInstance, repo: Repo, store: AttachmentStore) {
  app.post<{
    Body: {
      session_id: string;
      user_id: string;
      household_id: string;
      text: string;
      attachments?: { id: string }[];
    };
  }>('/v1/chat', async (req, reply) => {
    const { user_id, household_id, text, attachments } = req.body ?? ({} as any);
    if (!user_id || !household_id || (!text && !attachments?.length)) {
      return reply.code(400).send({ error: 'user_id, household_id, and text or attachments required' });
    }

    // Гілка з вкладеннями.
    if (attachments?.length) {
      const payloads: AttachmentPayload[] = [];
      for (const { id } of attachments) {
        const rec = await repo.getAttachment(id);
        if (!rec) return reply.code(404).send({ error: `attachment not found: ${id}` });
        if (rec.user_id !== user_id) return reply.code(403).send({ error: `forbidden attachment: ${id}` });
        const { buffer, content_type } = await store.get(rec.url);
        payloads.push({ kind: rec.kind, buffer, content_type, hint: rec.hint ?? undefined });
      }

      const call = await callAttachmentParse(payloads);
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

    // Звичайна гілка чату.
    const pantry = await repo.listBatches(household_id);
    const call = await callChat({ ...req.body, pantry });
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
