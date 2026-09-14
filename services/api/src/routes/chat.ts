import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Repo } from '@kitchen/domain';
import type { AttachmentStore } from '../attachment-store.js';
import { authenticated, requireUser } from '../middleware/session.js';
import { makeRateLimiter } from '../rate-limit.js';
import { tooMany } from '../too-many.js';
import { runChatTurn, saveScriptedTurn, ChatTurnHttpError, type ChatRouteOpts } from '../chat-turn.js';
import { helpTopicById } from '@kitchen/domain';
import { localDay } from '../local-day.js';

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

  // UI-NOTES-0914 п. 6: тап по чіпу довідки → дві репліки в розмову без
  // моделі. Ліміт той самий, що в чату (це запис у розмову, не читання).
  app.post<{ Body: { topic?: string; session_id?: string } }>('/v1/chat/scripted', { preHandler: [authenticated(repo), limitCheck] }, async (req, reply) => {
    const { user_id } = requireUser(req);
    const topic = helpTopicById(String(req.body?.topic ?? ''));
    if (!topic) return reply.code(400).send({ error: 'unknown topic' });
    let session = req.body?.session_id ? await repo.getSession(req.body.session_id) : null;
    if (session && session.user_id !== user_id) session = null;
    if (!session) session = await repo.getOrCreateSessionForDay(user_id, localDay());
    return saveScriptedTurn(repo, session.id, topic, topic.chip, 'web');
  });

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
