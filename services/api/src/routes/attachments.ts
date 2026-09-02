// POST /v1/attachments
//   multipart: file (household_id/user_id — з cookie-сесії, більше не в тілі)
//   → { id, url, kind, bytes, content_type }
// POST /v1/attachments/:id/reparse
//   { hint }
//   → { reply, card, card_id, raw_kind }

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Repo, AttachmentRecord, AttachmentKind } from '@kitchen/domain';
import { createPending } from '@kitchen/domain';
import type { AttachmentStore } from '../attachment-store.js';
import { callAttachmentParse } from '../model.js';
import { authenticated, requireUser } from '../middleware/session.js';
import { recordUsage } from '../usage.js';
import { stampChatReceipt } from '../receipt-source.js';
import { vetoNonfood } from '../nonfood-veto.js';

function kindOf(contentType: string): AttachmentKind {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType === 'application/pdf') return 'pdf';
  return 'text';
}

export function attachmentsRoutes(app: FastifyInstance, repo: Repo, store: AttachmentStore) {
  app.post('/v1/attachments', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id, household_id } = requireUser(req);
    if (typeof (req as any).file !== 'function') {
      return reply.code(500).send({ error: 'multipart not registered' });
    }
    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ error: 'no file' });

    const buffer: Buffer = await file.toBuffer();
    if (!buffer.byteLength) return reply.code(400).send({ error: 'empty file' });

    const id = randomUUID();
    const content_type = file.mimetype ?? 'application/octet-stream';
    const kind = kindOf(content_type);
    const stored = await store.put(id, buffer, content_type);

    const record: AttachmentRecord = {
      id,
      message_id: null,
      household_id,
      user_id,
      kind,
      url: stored.url,
      content_type,
      bytes: stored.bytes,
      hint: null,
      created_at: new Date().toISOString(),
    };
    await repo.saveAttachment(record);

    // Клієнту віддаємо ФЕТЧ-ЧЕРЕЗ URL — той самий origin, з cookie автентифікацією.
    // stored.url (fs://…, mem://…, blob://…) — внутрішній ідентифікатор сховища,
    // frontend його не бачить.
    return {
      id,
      url: `/v1/attachments/${id}/bytes`,
      kind,
      bytes: stored.bytes,
      content_type,
    };
  });

  // Стрім байтів по id. Потребує сесію користувача-власника; фото коморі й
  // журналі рендеряться в <img src="/v1/attachments/…/bytes"> — cookies летять
  // з same-origin запитом. Публічна роздача не потрібна: sharing розшарює
  // рецепт, не фотки.
  app.get<{ Params: { id: string } }>(
    '/v1/attachments/:id/bytes',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const att = await repo.getAttachment(req.params.id);
      if (!att) return reply.code(404).send({ error: 'not_found' });
      if (att.user_id !== user_id) return reply.code(403).send({ error: 'not_yours' });
      const { buffer, content_type } = await store.get(att.url);
      reply.header('Content-Type', content_type ?? att.content_type ?? 'application/octet-stream');
      reply.header('Cache-Control', 'private, max-age=3600');
      return reply.send(buffer);
    },
  );

  app.post<{
    Params: { id: string };
    Body: { hint: string };
  }>('/v1/attachments/:id/reparse', { preHandler: authenticated(repo) }, async (req, reply) => {
    const ctx = requireUser(req);
    const { user_id, household_id } = ctx;
    const { hint } = req.body ?? ({} as any);
    if (!hint) return reply.code(400).send({ error: 'hint required' });

    const att = await repo.getAttachment(req.params.id);
    if (!att) return reply.code(404).send({ error: 'attachment not found' });
    if (att.user_id !== user_id) return reply.code(403).send({ error: 'forbidden' });

    await repo.updateAttachment(att.id, { hint });

    const { buffer, content_type } = await store.get(att.url);
    const started = Date.now();
    const call = await callAttachmentParse([{
      kind: att.kind, buffer, content_type, hint,
    }]);
    await recordUsage(repo, ctx, 'attachment_parse', call.meta, call.usage, started);

    stampChatReceipt(call.card, call.raw_kind);
    vetoNonfood(call.card);

    let card_id: string | null = null;
    if (call.card) {
      card_id = randomUUID();
      await createPending(repo, {
        message_id: card_id,
        household_id,
        user_id,
        card: call.card,
      });
    }

    return {
      reply: call.reply,
      card: call.card,
      card_id,
      raw_kind: call.raw_kind,
      usage: call.usage,
      meta: call.meta,
    };
  });
}
