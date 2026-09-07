// Крок О1: GET /v1/admin/pulse?day=YYYY-MM-DD — те, що власник відкриває
// ввечері й розуміє, що сталось.
//
// Одиниця рахунку — ДІМ, не одна людина. Комора спільна, розмови спільні, і
// рахунок за модель приходить один; поки пульс дивився на власника, витрати й
// поведінка запрошених у дім не були видні ніде взагалі. Тому household_id
// того, хто відкрив пульс, і всі його учасники.
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
import type { Card, HouseholdRole, Repo, TokenUsageRow } from '@kitchen/domain';
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
  /** Чий це хід. У домі з двох людей без цього стрічка нечитабельна. */
  user_id: string;
  who: string;
  role: 'user' | 'assistant';
  text: string | null;
  card_type: string | null;
  /** Стан картки словом: застосована / скасована / відхилена / чекає. */
  card_state: string | null;
  latency_ms: number | null;
  usd: number | null;
}

export interface PulseMoney {
  calls: number;
  input: number;
  output: number;
  cached: number;
  usd: number;
}

const inRange = (iso: string, from: Date, to: Date) => {
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
};

function sum(rows: TokenUsageRow[]): PulseMoney {
  return {
    calls: rows.length,
    input: rows.reduce((n, r) => n + r.input_tokens, 0),
    output: rows.reduce((n, r) => n + r.output_tokens, 0),
    cached: rows.reduce((n, r) => n + r.cached_tokens, 0),
    usd: Number(rows.reduce((n, r) => n + (priceOf(r) ?? 0), 0).toFixed(4)),
  };
}

export function pulseRoutes(app: FastifyInstance, repo: Repo) {
  app.get<{ Querystring: { day?: string } }>(
    '/v1/admin/pulse',
    { preHandler: [authenticated(repo), requireAdmin(repo)] },
    async (req) => {
      const me = requireUser(req);
      const household_id = me.household_id;
      const day = req.query.day ?? new Date().toISOString().slice(0, 10);
      const { from, to } = dayBounds(day);
      const week = new Date(from);
      week.setDate(week.getDate() - 6);

      // Хто живе в цьому домі. Імена й ролі потрібні всім трьом блокам, тож
      // читаються один раз і роздаються далі мапою.
      const members = await repo.listMembersOfHousehold(household_id);
      const nameOf = new Map(members.map((m) => [m.user_id, m.name] as const));
      const roleOf = new Map(members.map((m) => [m.user_id, m.role] as const));

      // ---- Розмови ----------------------------------------------------
      // Сесії лежать по людях — тут цикл чесний: учасників одиниці, і
      // окремий запит «сесії дому» був би структурою заради структури.
      const usage = await repo.listTokenUsageForHousehold(household_id, 1000);
      const usageOfDay = usage.filter((u) => inRange(u.created_at, from, to));

      const turns: PulseTurn[] = [];
      for (const m of members) {
        const sessions = await repo.listSessionsForUser(m.user_id, 30);
        for (const s of sessions.filter((x) => inRange(x.created_at, from, to))) {
          for (const msg of await repo.listMessages(s.id)) {
            const pending = msg.card ? await repo.getPending(msg.id) : null;
            turns.push({
              at: msg.created_at,
              user_id: m.user_id,
              who: m.name,
              role: msg.role,
              text: msg.text,
              card_type: (msg.card as Card | null)?.type ?? null,
              card_state: !msg.card ? null
                : pending?.undone_at ? 'скасована'
                : pending?.dismissed_at ? 'відхилена'
                : msg.applied > 0 ? 'застосована'
                : 'чекає',
              latency_ms: null,
              usd: null,
            });
          }
        }
      }
      turns.sort((a, b) => a.at.localeCompare(b.at));
      // Латентність і ціна лежать у token_usage і не мають вказівника на
      // повідомлення — зшиваємо за часом: найближчий виклик ТІЄЇ САМОЇ людини
      // в межах хвилини. Без звірки за людиною в домі з двох чат одного міг би
      // забрати ціну виклику іншого.
      for (const t of turns) {
        if (t.role !== 'assistant') continue;
        const tt = new Date(t.at).getTime();
        const near = usageOfDay.find((u) => u.user_id === t.user_id
          && Math.abs(new Date(u.created_at).getTime() - tt) < 60_000);
        if (!near) continue;
        t.latency_ms = near.latency_ms;
        t.usd = priceOf(near);
      }

      // ---- Гроші --------------------------------------------------------
      // Підсумок дому і окремим рядком кожна людина: рахунок приходить один,
      // але видно має бути, з чого він склався.
      const usageOfWeek = usage.filter((u) => inRange(u.created_at, week, to));
      const byMember = members.map((m) => ({
        user_id: m.user_id,
        name: m.name,
        role: m.role as HouseholdRole,
        day: sum(usageOfDay.filter((u) => u.user_id === m.user_id)),
        week: sum(usageOfWeek.filter((u) => u.user_id === m.user_id)),
      }));

      // ---- Події ---------------------------------------------------------
      // Разом з інцидентами: вони лежать у тій самій таблиці під `incident:*`,
      // і на стрічці дня читаються поруч із поведінкою — саме там видно, що
      // людина зробила ПЕРЕД тим, як щось зламалось.
      const events = await repo.listAppEventsForHousehold(household_id, { from, to, limit: 500 });

      return {
        day,
        household_id,
        members: members.map((m) => ({ user_id: m.user_id, name: m.name, role: m.role })),
        turns,
        money: { day: sum(usageOfDay), week: sum(usageOfWeek), byMember },
        events: events.map((e) => ({
          ...e,
          who: nameOf.get(e.user_id) ?? '—',
          role: roleOf.get(e.user_id) ?? null,
        })),
      };
    },
  );
}
