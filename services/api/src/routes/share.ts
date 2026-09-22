// Шерінг v3 (spec docs/superpowers/specs/2026-09-22-share-v3-design.md, §2 «Надсилання
// в Telegram»): POST /v1/share/telegram — кадр PNG із /share їде людині в її чат з ботом
// (перший випадок, коли бот шле фото). multipart { png, recipe_id, frame }, ≤ 10 МБ,
// лише image/png; без живої привʼязки Telegram — 409 telegram_not_linked.
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Repo } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';

export const SHARE_PNG_MAX = 10 * 1024 * 1024;

export interface ShareOpts {
  /** Доставка фото в чат (grammY bot.api.sendPhoto через InputFile); у тестах — стаб. */
  sendPhoto?: (chat_id: number, png: Buffer, caption: string) => Promise<void>;
}

export function shareRoutes(app: FastifyInstance, repo: Repo, opts: ShareOpts = {}) {
  app.post('/v1/share/telegram', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id, household_id } = requireUser(req);
    if (!opts.sendPhoto) return reply.code(503).send({ error: 'telegram_not_configured' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- як у attachments.ts
    if (typeof (req as any).file !== 'function') return reply.code(500).send({ error: 'multipart not registered' });
    const tg = await repo.getTelegramByUser(user_id);
    if (!tg || tg.revoked_at || tg.chat_id == null) return reply.code(409).send({ error: 'telegram_not_linked' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- multipart plugin
    const file = await (req as any).file({ limits: { fileSize: SHARE_PNG_MAX } });
    if (!file) return reply.code(400).send({ error: 'png required' });
    if (file.mimetype !== 'image/png') return reply.code(415).send({ error: 'png_only' });
    const fields = file.fields as Record<string, { value?: unknown } | undefined>;
    const recipe_id = String(fields.recipe_id?.value ?? '');
    const frame = String(fields.frame?.value ?? '');
    if (!recipe_id) return reply.code(400).send({ error: 'recipe_id required' });
    let png: Buffer;
    try { png = await file.toBuffer(); }
    catch { return reply.code(413).send({ error: 'png_too_large' }); }
    if (!png.byteLength) return reply.code(400).send({ error: 'empty png' });
    if (png.byteLength > SHARE_PNG_MAX) return reply.code(413).send({ error: 'png_too_large' });

    const recipe = await repo.getRecipe(recipe_id);
    if (!recipe || recipe.owner_id !== user_id) return reply.code(404).send({ error: 'recipe not found' });

    try {
      await opts.sendPhoto(tg.chat_id, png, recipe.title);
    } catch (err) {
      req.log.warn({ err: String(err), user_id }, 'share-telegram-send-failed');
      return reply.code(502).send({ error: 'telegram_send_failed' });
    }
    await repo.saveAppEvents([{
      id: randomUUID(), user_id, household_id, name: 'share',
      props: { frame, via: 'telegram', photo: true, recipe_id }, viewport_w: null, device_class: null, ua_family: null, created_at: new Date().toISOString(),
    }]).catch((err: unknown) => req.log.warn({ err: String(err) }, 'share-event-failed'));
    return { ok: true };
  });
}
