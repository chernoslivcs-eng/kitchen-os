import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { callChat, callAttachmentParse, type AttachmentPayload } from '../model.js';
import { createPending, type Repo } from '@kitchen/domain';
import type { AttachmentStore } from '../attachment-store.js';
import { authenticated, requireUser } from '../middleware/session.js';
import { recordUsage } from '../usage.js';
import { makeRateLimiter, type RateLimitCfg } from '../rate-limit.js';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// POST /v1/chat
//   { text?, attachments?: [{id}] } → { reply, card, card_id, usage, meta }
//
// Побічних ефектів на комору НЕ застосовує. Картка йде як пропозиція,
// клієнт натискає apply. Обидва повідомлення (user + assistant) пишуться
// в message/session — щоб чат переживав F5 і перезапуск сервера.

export interface ChatRouteOpts {
  rateLimit?: RateLimitCfg;
}

export function chatRoute(app: FastifyInstance, repo: Repo, store: AttachmentStore, opts: ChatRouteOpts = {}) {
  // Ліміт для чату — щоб залогінений юзер (свідомо чи ні) не наспамив у модель тисячу
  // запитів за хвилину. 30 запитів/хв — це «людина активно спілкується» на верхній межі,
  // явно замало для ліберпетлі. Ключ — user_id, не IP: розділяємо кухні в спільній мережі.
  const cfg = opts.rateLimit ?? { max: 30, windowMs: 60_000 };
  const limiter = makeRateLimiter(cfg);
  const limitCheck = async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = requireUser(req);
    if (!limiter.check(ctx.user_id)) {
      reply.code(429).send({ error: 'too many requests' });
      return reply;
    }
  };

  app.post<{
    Body: {
      session_id?: string;
      text?: string;
      attachments?: { id: string }[];
    };
  }>('/v1/chat', { preHandler: [authenticated(repo), limitCheck] }, async (req, reply) => {
    const ctx = requireUser(req);
    const { user_id, household_id } = ctx;
    const { text, attachments } = req.body ?? {};
    if (!text && !attachments?.length) {
      return reply.code(400).send({ error: 'text or attachments required' });
    }

    const session = await repo.getOrCreateSessionForDay(user_id, today());

    if (attachments?.length) {
      const payloads: AttachmentPayload[] = [];
      for (const { id } of attachments) {
        const rec = await repo.getAttachment(id);
        if (!rec) return reply.code(404).send({ error: `attachment not found: ${id}` });
        if (rec.user_id !== user_id) return reply.code(403).send({ error: `forbidden attachment: ${id}` });
        const { buffer, content_type } = await store.get(rec.url);
        payloads.push({ kind: rec.kind, buffer, content_type, hint: rec.hint ?? undefined });
      }
      // Спершу записуємо user-message (текст + факт вкладень).
      const userMsgText = text?.trim() || (attachments.length === 1 ? '[вкладення]' : `[${attachments.length} вкладення]`);
      await repo.saveMessage({
        id: randomUUID(), session_id: session.id, role: 'user',
        text: userMsgText, card: null, applied: 0, created_at: new Date().toISOString(),
      });

      const started = Date.now();
      const call = await callAttachmentParse(payloads);
      await recordUsage(repo, ctx, 'attachment_parse', call.meta, call.usage, started);
      const card_id = call.card ? randomUUID() : null;
      if (call.card && card_id) {
        await createPending(repo, { message_id: card_id, household_id, user_id, card: call.card });
      }
      await repo.saveMessage({
        id: card_id ?? randomUUID(), session_id: session.id, role: 'assistant',
        text: call.reply ?? null, card: call.card, applied: 0, created_at: new Date().toISOString(),
      });
      return {
        reply: call.reply, card: call.card, card_id,
        raw_kind: call.raw_kind, usage: call.usage, meta: call.meta,
      };
    }

    const pantry = await repo.listBatches(household_id);
    // Онбординг: stage 1, поки в коморі порожньо; stage 2, коли комора наповнена,
    // а профіль ще не має відповіді на «алергії/дім/традиції» (як проксі — порожні три блоки).
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

    await repo.saveMessage({
      id: randomUUID(), session_id: session.id, role: 'user',
      text: text ?? '', card: null, applied: 0, created_at: new Date().toISOString(),
    });

    // Останні 5 приготувань з рейтингом і verdict — щоб модель памʼятала,
    // що зайшло, а що ні. undone-runs не показуємо (то помилки, не історія).
    const rawRuns = await repo.listCookRuns(user_id, 8);
    const recentCookRuns = rawRuns
      .filter((r) => !r.undone_at)
      .slice(0, 5)
      .map((r) => ({
        title: r.recipe.title,
        rating: r.rating,
        verdict: r.verdict,
        finished_at: r.finished_at ?? r.started_at,
      }));

    const started = Date.now();
    const call = await callChat({
      user_id, session_id: session.id, text: text ?? '', pantry, stage, recentCookRuns,
    });
    await recordUsage(repo, ctx, 'chat', call.meta, call.usage, started);
    const card_id = call.card ? randomUUID() : null;
    if (call.card && card_id) {
      await createPending(repo, { message_id: card_id, household_id, user_id, card: call.card });
    }
    await repo.saveMessage({
      id: card_id ?? randomUUID(), session_id: session.id, role: 'assistant',
      text: call.reply ?? null, card: call.card, applied: 0, created_at: new Date().toISOString(),
    });
    return {
      reply: call.reply, card: call.card, card_id,
      usage: call.usage, meta: call.meta,
    };
  });
}
