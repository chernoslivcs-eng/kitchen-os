// Р147: контракт для веб-профілю (його робить інша сесія), за кукою kos:
//   GET    /v1/telegram            → { linked, username: string | null, linked_at: string | null }
//   POST   /v1/telegram/link-token → { url: 'https://t.me/<username>?start=<token>', expires_at }
//   DELETE /v1/telegram            → { ok: true }
import type { FastifyInstance } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { createTelegramLinkToken, resolveBotUsername } from '../telegram.js';

export function telegramRoutes(app: FastifyInstance, repo: Repo): void {
  app.get('/v1/telegram', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id } = requireUser(req);
    const a = await repo.getTelegramByUser(user_id);
    return { linked: !!a, username: await resolveBotUsername(), linked_at: a?.linked_at ?? null };
  });
  app.post('/v1/telegram/link-token', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id } = requireUser(req);
    const username = await resolveBotUsername();
    if (!username) return reply.code(503).send({ error: 'telegram_not_configured' });
    const { url, expires_at } = await createTelegramLinkToken(repo, user_id, username);
    return { url, expires_at };
  });
  app.delete('/v1/telegram', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id } = requireUser(req);
    const now = new Date().toISOString();
    await repo.revokeTelegram(user_id, now);
    await repo.revokeTelegramWebTokens(user_id, now);   // E: лінк у веб із бота — теж
    return { ok: true };
  });
}
