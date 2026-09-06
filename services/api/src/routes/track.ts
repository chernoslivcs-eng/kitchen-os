// Крок О1а: POST /v1/events/track — прийом подій поведінки.
//
// Окремий файл, а не в routes/events.ts: там календар дому, і спільне в них
// лише слово «події» в адресі. Плутати їх у коді дорожче, ніж мати ще один
// маленький роутер.
//
// user_id береться З СЕСІЇ, а не з тіла. Клієнт його не надсилає й надіслати
// не може: інакше будь-хто писав би події в чужу стрічку.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppEventRow, Repo } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { makeRateLimiter } from '../rate-limit.js';
import { tooMany } from '../too-many.js';

/** Стеля пачки. Більше двадцяти за раз означає, що щось у клієнті циклиться. */
export const MAX_BATCH = 20;

/**
 * Імена подій — закритий список. Не заради валідації заради валідації: без
 * нього перша ж помилка в клієнті засмітить стрічку дня іменами-опечатками, і
 * шукати в ній стане нічим.
 */
export const KNOWN_EVENTS = new Set([
  'pantry_opened', 'pantry_filter_changed', 'pantry_card_opened',
  'recipe_opened', 'cook_started', 'cook_step_reached', 'cook_finished', 'cook_abandoned',
  'shopping_opened', 'calendar_opened',
  'attachment_added',
  'chat_input_abandoned',
  'error_shown',
]);

interface TrackBody {
  events?: { name?: string; props?: Record<string, unknown>; at?: string }[];
}

export function trackRoutes(app: FastifyInstance, repo: Repo) {
  // Двісті подій на пʼять хвилин: клієнт шле раз на 10 с пачками, тож навіть
  // дуже активна людина не підходить до стелі близько.
  const limiter = makeRateLimiter({ max: 200, windowMs: 5 * 60_000 });

  app.post<{ Body: TrackBody }>('/v1/events/track', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id, household_id } = requireUser(req);
    if (!limiter.check(user_id)) return tooMany(reply, limiter, user_id);

    const incoming = req.body?.events;
    if (!Array.isArray(incoming) || !incoming.length) return { accepted: 0 };
    if (incoming.length > MAX_BATCH) return reply.code(400).send({ error: 'batch too large' });

    const now = Date.now();
    const rows: AppEventRow[] = [];
    for (const e of incoming) {
      if (!e?.name || !KNOWN_EVENTS.has(e.name)) continue;   // невідоме тихо викидаємо
      // Час події — клієнтський (подія сталась до відправки), але в межах
      // розумного: годину в минуле і хвилину в майбутнє. Інакше збитий
      // годинник на машині людини розмазав би стрічку дня на роки.
      const at = e.at ? new Date(e.at).getTime() : now;
      const ok = Number.isFinite(at) && at > now - 3600_000 && at < now + 60_000;
      rows.push({
        id: randomUUID(),
        user_id,
        household_id,
        name: e.name,
        props: e.props && typeof e.props === 'object' ? e.props : {},
        created_at: new Date(ok ? at : now).toISOString(),
      });
    }
    if (rows.length) await repo.saveAppEvents(rows);
    // Втрата події — не помилка: клієнт повторів не робить, і знати йому про
    // відкинуті теж не треба.
    return { accepted: rows.length };
  });
}
