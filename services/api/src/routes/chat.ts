import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Repo } from '@kitchen/domain';
import type { AttachmentStore } from '../attachment-store.js';
import { authenticated, requireUser } from '../middleware/session.js';
import { makeRateLimiter } from '../rate-limit.js';
import { tooMany } from '../too-many.js';
import { runChatTurn, ChatTurnHttpError, type ChatRouteOpts } from '../chat-turn.js';

export type { ChatRouteOpts } from '../chat-turn.js';

// POST /v1/chat
//   { text?, attachments?: [{id}] } → { reply, card, card_id, usage, meta }
//
// Сам хід живе в chat-turn.ts (Р149: той самий хід кличе Telegram-бот). Тут —
// лише HTTP: кука, ліміт, тіло запиту, коди помилок.
export function chatRoute(app: FastifyInstance, repo: Repo, store: AttachmentStore, opts: ChatRouteOpts = {}) {
  // Ліміт для чату — щоб залогінений юзер (свідомо чи ні) не наспамив у модель тисячу
  // запитів за хвилину. 30 запитів/хв — це «людина активно спілкується» на верхній межі,
  // явно замало для ліберпетлі. Ключ — user_id, не IP: розділяємо кухні в спільній мережі.
  const cfg = opts.rateLimit ?? { max: 30, windowMs: 60_000 };
  const limiter = makeRateLimiter(cfg);
  const limitCheck = async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = requireUser(req);
    if (!limiter.check(ctx.user_id)) {
      tooMany(reply, limiter, ctx.user_id, 'chat');
      return reply;
    }
  };

  app.post<{
    Body: {
      session_id?: string;
      text?: string;
      attachments?: { id: string }[];
      // Крок 7: «Показати, що вийшло» — серверний хід без репліки людини.
      action?: 'profile_summary';
    };
  }>('/v1/chat', { preHandler: [authenticated(repo), limitCheck] }, async (req, reply) => {
    const { user_id, household_id } = requireUser(req);
    const { attachments, session_id, action, text } = req.body ?? {};
    try {
      // Крок А1а: у раковину їде сам ЗАПИТ, а не його логер: на ньому ж лишається
      // незавершений запис, якого сервер дочекається перед відповіддю (telemetry.ts).
      return await runChatTurn(repo, store, opts, { user: { user_id, household_id }, text, attachments, session_id, action, channel: 'web', host: req, log: req.log });
    } catch (err) {
      if (err instanceof ChatTurnHttpError) return reply.code(err.status).send(err.body);
      throw err;
    }
  });
}
