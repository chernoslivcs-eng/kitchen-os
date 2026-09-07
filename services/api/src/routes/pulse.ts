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
  /** id повідомлення — за ним token_usage знаходить свій хід (крок А1). */
  message_id: string;
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
  /**
   * Крок А2: ЯК порахована ціна, а не тільки скільки.
   *
   *   'message' — точно: рядки token_usage з message_id цього ходу, сумою.
   *   'time'    — оцінка: найближчий виклик тієї самої людини в межах хвилини.
   *               Так зшивалось усе, що записано до А1, і інакше вже не буде.
   *   null      — виклику моделі на цьому ході не було взагалі.
   *
   * Точна ціна й оцінка не мають виглядати однаково: на оцінці не можна
   * будувати юніт-економіку, і людина мусить бачити різницю, а не здогадуватись.
   */
  price_from: 'message' | 'time' | null;
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

/**
 * Крок А2: ціна хода — точна там, де є указівник, і оцінка там, де його нема.
 *
 * До А1 у token_usage не було нічого, що зв'язувало виклик моделі з ходом, і
 * пульс зшивав їх ЗДОГАДКОЮ: найближчий виклик тієї самої людини в межах
 * хвилини. Уся юніт-економіка стояла на цій здогадці.
 *
 * Тепер у нових рядків є `message_id` — і він указує на ПОВІДОМЛЕННЯ ЛЮДИНИ,
 * яке спричинило виклик. Одне звернення до /v1/chat може дати кілька викликів
 * під тим самим id (сам чат, генерація рецепта всередині нього, повтор після
 * вето), тому ціна хода — це СУМА таких рядків, а не найближчий із них.
 *
 * Показуємо суму на першій відповіді асистента в цьому ході, а не на репліці
 * людини: там же стоїть латентність, і розносити дві половини одного факту по
 * різних рядках означало б зробити таблицю нечитабельною. Наступні відповіді
 * того самого ходу лишаються порожні — інакше та сама сума порахувалась би
 * двічі.
 *
 * Старі рядки (усе, що записано до А1) указівника не мають і вже не матимуть:
 * заднім числом його не відновити. Для них лишається зшивання за часом — але
 * тепер воно чесно підписане як оцінка.
 */
export function attachPrice(turns: PulseTurn[], usage: TokenUsageRow[]): void {
  // Рядки обліку за ходом людини. Кілька викликів на один хід — норма.
  const byMessage = new Map<string, TokenUsageRow[]>();
  for (const u of usage) {
    if (!u.message_id) continue;
    const list = byMessage.get(u.message_id);
    if (list) list.push(u); else byMessage.set(u.message_id, [u]);
  }

  // Хід, до якого належить кожна відповідь: остання репліка людини перед нею.
  // Це не здогадка — це структура розмови: усе, що асистент сказав після
  // повідомлення людини, сказане у відповідь на нього.
  let anchor: string | null = null;
  const spent = new Set<string>();

  for (const t of turns) {
    if (t.role === 'user') { anchor = t.message_id; continue; }

    const rows = anchor ? byMessage.get(anchor) : undefined;
    if (rows && anchor && !spent.has(anchor)) {
      spent.add(anchor);
      t.usd = Number(rows.reduce((n, r) => n + (priceOf(r) ?? 0), 0).toFixed(6));
      // Латентність теж сумою: якщо на хід пішло три виклики, людина чекала
      // всі три, а не найдовший із них.
      const ms = rows.reduce((n, r) => n + (r.latency_ms ?? 0), 0);
      t.latency_ms = ms || null;
      t.price_from = 'message';
      continue;
    }
    if (rows) continue;   // сума вже показана на попередній відповіді цього ходу

    // Фолбек для старих рядків: найближчий виклик ТІЄЇ САМОЇ людини в межах
    // хвилини. Звірка за людиною обов'язкова — у домі з двох чат одного інакше
    // забрав би ціну виклику іншого.
    const tt = new Date(t.at).getTime();
    const near = usage.find((u) => !u.message_id && u.user_id === t.user_id
      && Math.abs(new Date(u.created_at).getTime() - tt) < 60_000);
    if (!near) continue;
    t.latency_ms = near.latency_ms;
    t.usd = priceOf(near);
    t.price_from = 'time';
  }
}

export function pulseRoutes(app: FastifyInstance, repo: Repo) {
  app.get<{ Querystring: { day?: string; household_id?: string } }>(
    '/v1/admin/pulse',
    { preHandler: [authenticated(repo), requireAdmin(repo)] },
    async (req) => {
      const me = requireUser(req);
      // Крок А2: пульс приймає дім. Немає параметра — свій, як було.
      //
      // Видимість чужого дому ПОВНА: розмови з текстом, гроші, події. Це
      // рішення власника — він цих людей особисто кликав і дивиться на пілот,
      // а не підглядає. Урізати текст означало б зробити адмінку марною саме
      // там, де вона потрібна.
      //
      // Не-адмін сюди не доходить узагалі (requireAdmin вище віддає 404), тож
      // підібрати household_id і дізнатись, що такий дім існує, неможливо.
      const household_id = req.query.household_id ?? me.household_id;
      const guest = household_id !== me.household_id;
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
              message_id: msg.id,
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
              price_from: null,
            });
          }
        }
      }
      turns.sort((a, b) => a.at.localeCompare(b.at));
      attachPrice(turns, usageOfDay);

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

      const household = await repo.getHousehold(household_id);

      return {
        day,
        household_id,
        household_name: household?.name ?? null,
        /** Чужий дім. Екран мусить показати це сам, а не лише адресним рядком. */
        guest,
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
