// Шерінг v3 (spec §2, «Надсилання в Telegram»): POST /v1/share/telegram —
// кадр (PNG, малює клієнт) прямо в тіло multipart, без attachment-id:
// Telegram фетчить фото сервер-сервер і session-cookied
// /v1/attachments/:id/bytes йому не доступний.
//
// Окремий, самодостатній роут — не чіпає розмовну логіку бота
// (telegram-bot.ts, bot.on(...)): своя, одноразова grammY Bot без
// зареєстрованих хендлерів, той самий патерн, що cron-digest-handler.ts
// (bot.api.sendPhoto — сирий виклик Bot API, не через makeTelegramBot).
import type { FastifyInstance } from 'fastify';
import type { Repo } from '@kitchen/domain';
import type { Recipe } from '@kitchen/domain';
import { Bot, InputFile } from 'grammy';
import { authenticated, requireUser } from '../middleware/session.js';
import { telegramFetch, botInfoFor } from '../telegram-bot.js';

const MAX_PNG_BYTES = 10 * 1024 * 1024; // Telegram sendPhoto ліміт (spec: PNG 1080×1920 ≈ 2–4 МБ)

export function shareTelegramRoutes(app: FastifyInstance, repo: Repo): void {
  app.post('/v1/share/telegram', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id } = requireUser(req);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return reply.code(503).send({ error: 'telegram_not_configured' });

    const account = await repo.getTelegramByUser(user_id);
    if (!account || account.revoked_at || !account.chat_id) {
      return reply.code(409).send({ error: 'telegram_no_chat' });
    }

    if (typeof (req as { file?: unknown }).file !== 'function') {
      return reply.code(500).send({ error: 'multipart not registered' });
    }
    const part = await (req as { file: () => Promise<{ toBuffer: () => Promise<Buffer>; fields: Record<string, { value?: unknown }> } | undefined> }).file();
    if (!part) return reply.code(400).send({ error: 'no_file' });
    const buffer = await part.toBuffer();
    if (!buffer.byteLength) return reply.code(400).send({ error: 'empty_file' });
    if (buffer.byteLength > MAX_PNG_BYTES) return reply.code(413).send({ error: 'file_too_large' });

    const recipeId = typeof part.fields.recipe_id?.value === 'string' ? part.fields.recipe_id.value : null;
    if (!recipeId) return reply.code(400).send({ error: 'recipe_id_required' });
    const row = await repo.getRecipe(recipeId);
    if (!row || row.owner_id !== user_id) return reply.code(404).send({ error: 'not_found' });
    const recipe = row.payload as Recipe;

    try {
      const bot = new Bot(token, { botInfo: botInfoFor(token, process.env.TELEGRAM_BOT_USERNAME), client: { fetch: telegramFetch as never } });
      await bot.api.sendPhoto(account.chat_id, new InputFile(buffer), { caption: recipe.t });
    } catch (err) {
      req.log.warn({ err }, 'share-telegram: sendPhoto failed');
      return reply.code(502).send({ error: 'send_failed' });
    }
    return { sent: true };
  });
}
