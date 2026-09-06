// Крок О1а: GET /v1/admin/pulse?day=YYYY-MM-DD — те, що власник відкриває
// ввечері й розуміє, що сталось.
//
// Без графіків і без красивого: три блоки за день, читабельні таблицею.
// Нічого нового не збираємо — розмови вже лежать у message, стан карток у
// card_pending, гроші в token_usage, події в app_event.
//
// Доступ — той самий requireAdmin, що в адмінці приводів: 404, а не 403.
// Це усталене рішення продукту («чужий не мусить знати, що адмінка взагалі
// існує»), і робити тут виняток означало б розказати сторонньому про
// існування сторінки самим кодом відповіді.

import type { FastifyInstance } from 'fastify';
import type { Card, Repo } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { requireAdmin } from '../middleware/admin.js';
import { priceOf } from '../pricing.js';

/** День у локальних межах: пульс читають по днях життя, не по UTC. */
function dayBounds(day: string): { from: Date; to: Date } {
  const from = new Date(`${day}T00:00:00`);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

export interface PulseTurn {
  at: string;
  role: 'user' | 'assistant';
  text: string | null;
  card_type: string | null;
  /** Стан картки словом: застосована / скасована / відхилена / чекає. */
  card_state: string | null;
  latency_ms: number | null;
  usd: number | null;
}

export function pulseRoutes(app: FastifyInstance, repo: Repo) {
  app.get<{ Querystring: { day?: string; user?: string } }>(
    '/v1/admin/pulse',
    { preHandler: [authenticated(repo), requireAdmin(repo)] },
    async (req) => {
      const me = requireUser(req);
      // Дивитись можна за іншого користувача — власник і є той, хто розбирає
      // чужий день. За замовчуванням — свій.
      const user_id = req.query.user ?? me.user_id;
      const day = req.query.day ?? new Date().toISOString().slice(0, 10);
      const { from, to } = dayBounds(day);

      // ---- Розмови ----------------------------------------------------
      const sessions = await repo.listSessionsForUser(user_id, 30);
      const ofDay = sessions.filter((s) => {
        const t = new Date(s.created_at).getTime();
        return t >= from.getTime() && t < to.getTime();
      });
      const usage = await repo.listTokenUsage(user_id, 500);
      const usageOfDay = usage.filter((u) => {
        const t = new Date(u.created_at).getTime();
        return t >= from.getTime() && t < to.getTime();
      });

      const turns: PulseTurn[] = [];
      for (const s of ofDay) {
        for (const m of await repo.listMessages(s.id)) {
          const pending = m.card ? await repo.getPending(m.id) : null;
          turns.push({
            at: m.created_at,
            role: m.role,
            text: m.text,
            card_type: (m.card as Card | null)?.type ?? null,
            card_state: !m.card ? null
              : pending?.undone_at ? 'скасована'
              : pending?.dismissed_at ? 'відхилена'
              : m.applied > 0 ? 'застосована'
              : 'чекає',
            latency_ms: null,
            usd: null,
          });
        }
      }
      turns.sort((a, b) => a.at.localeCompare(b.at));
      // Латентність і ціна лежать у token_usage і не мають вказівника на
      // повідомлення — зшиваємо за часом: найближчий виклик у межах хвилини.
      for (const t of turns) {
        if (t.role !== 'assistant') continue;
        const tt = new Date(t.at).getTime();
        const near = usageOfDay.find((u) => Math.abs(new Date(u.created_at).getTime() - tt) < 60_000);
        if (!near) continue;
        t.latency_ms = near.latency_ms;
        t.usd = priceOf(near);
      }

      // ---- Гроші --------------------------------------------------------
      const week = new Date(from);
      week.setDate(week.getDate() - 6);
      const usageOfWeek = usage.filter((u) => {
        const t = new Date(u.created_at).getTime();
        return t >= week.getTime() && t < to.getTime();
      });
      const sum = (rows: typeof usage) => ({
        calls: rows.length,
        input: rows.reduce((n, r) => n + r.input_tokens, 0),
        output: rows.reduce((n, r) => n + r.output_tokens, 0),
        cached: rows.reduce((n, r) => n + r.cached_tokens, 0),
        usd: Number(rows.reduce((n, r) => n + (priceOf(r) ?? 0), 0).toFixed(4)),
      });

      // ---- Події ---------------------------------------------------------
      // Разом з інцидентами: вони лежать у тій самій таблиці під `incident:*`,
      // і на стрічці дня читаються поруч із поведінкою — саме там видно, що
      // людина зробила ПЕРЕД тим, як щось зламалось.
      const events = await repo.listAppEvents(user_id, { from, to, limit: 500 });

      return {
        day,
        user_id,
        turns,
        money: { day: sum(usageOfDay), week: sum(usageOfWeek) },
        events,
      };
    },
  );
}
