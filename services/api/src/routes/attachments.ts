// POST /v1/attachments
//   multipart: file, plus form fields household_id, user_id
//   → { id, url, kind, bytes, content_type }
// POST /v1/attachments/:id/reparse
//   { user_id, hint }
//   → { reply, card, card_id, raw_kind }   // повторний розбір тим самим файлом із підказкою

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Repo, AttachmentRecord, AttachmentKind } from '@kitchen/domain';
import { createPending } from '@kitchen/domain';
import type { AttachmentStore } from '../attachment-store.js';
import { callAttachmentParse } from '../model.js';

function kindOf(contentType: string): AttachmentKind {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType === 'application/pdf') return 'pdf';
  return 'text';
}

export function attachmentsRoutes(app: FastifyInstance, repo: Repo, store: AttachmentStore) {
  app.post('/v1/attachments', async (req, reply) => {
    // Потрібен зареєстрований @fastify/multipart. Виносимо перевірку сюди — краще 400,
    // ніж мовчазний upload через body.
    if (typeof (req as any).file !== 'function') {
      return reply.code(500).send({ error: 'multipart not registered' });
    }
    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ error: 'no file' });

    // household_id і user_id очікуємо у полях multipart (multipart парсить їх у file.fields).
    const household_id = file.fields?.household_id?.value;
    const user_id = file.fields?.user_id?.value;
    if (!household_id || !user_id) {
      return reply.code(400).send({ error: 'household_id and user_id required (multipart fields)' });
    }

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

    return { id, url: stored.url, kind, bytes: stored.bytes, content_type };
  });

  // Повторний розбір із уточненням. Той самий файл, той самий промпт, плюс hint.
  // Причина існування цього ендпоінта — розпізнавання помиляється принципово (див. 03-prompts.md).
  // Не перегенеровуємо промпт «розумнішим» — даємо людині поправити прямо, її слово важливіше.
  app.post<{
    Params: { id: string };
    Body: { user_id: string; hint: string; household_id?: string };
  }>('/v1/attachments/:id/reparse', async (req, reply) => {
    const { user_id, hint } = req.body ?? {};
    if (!user_id || !hint) return reply.code(400).send({ error: 'user_id and hint required' });

    const att = await repo.getAttachment(req.params.id);
    if (!att) return reply.code(404).send({ error: 'attachment not found' });
    if (att.user_id !== user_id) return reply.code(403).send({ error: 'forbidden' });

    await repo.updateAttachment(att.id, { hint });

    const { buffer, content_type } = await store.get(att.url);
    const call = await callAttachmentParse([{
      kind: att.kind, buffer, content_type, hint,
    }]);

    let card_id: string | null = null;
    if (call.card) {
      card_id = randomUUID();
      await createPending(repo, {
        message_id: card_id,
        household_id: att.household_id,
        user_id: att.user_id,
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
