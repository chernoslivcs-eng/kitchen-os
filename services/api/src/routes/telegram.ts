// Р147: профіль → «Telegram · Підключити / підключено · Відключити».
import type { FastifyInstance } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { createTelegramLinkToken, TELEGRAM_BOT_USERNAME, TELEGRAM_LINK_TTL_MS } from '../telegram.js';

export function telegramRoutes(app: FastifyInstance, repo: Repo): void {
  app.get('/v1/telegram', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id } = requireUser(req);
    const a = await repo.getTelegramByUser(user_id);
    return { linked: !!a, username: TELEGRAM_BOT_USERNAME() };
  });
  app.post('/v1/telegram/link-token', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id } = requireUser(req);
    const { token, url } = await createTelegramLinkToken(repo, user_id);
    return { token, url, expires_in_min: TELEGRAM_LINK_TTL_MS / 60_000 };
  });
  app.delete('/v1/telegram', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id } = requireUser(req);
    await repo.revokeTelegram(user_id, new Date().toISOString());
    return { linked: false };
  });
}
