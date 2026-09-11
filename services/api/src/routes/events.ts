// GET    /v1/events?from&to  → { events } — глобальні й домашні одним списком
// POST   /v1/events          → створити подію дому (П1: і diet/custom з from/to/rule_text/strict)
// PATCH  /v1/events/:id      → правка
// DELETE /v1/events/:id      → 204
// GET    /v1/occasions?set=&year=          → набір для картки серії, з датами й галочками (П1)
// GET/PUT /v1/occasions/subscriptions      → відхилення від дефолту / батч галочок (П1)
// GET    /v1/now                            → активні сьогодні одним контрактом (П1)
//
// Ендпойнт відповідає на одне питання: що припадає на цей відрізок часу.
// Не «що зараз» (це вміє контекст промпта) і не «що попереду» (це стрічка в
// профілі), а саме відрізок — бо календар гортають, а не звіряються з ним.
//
// Глобальні й домашні події приходять ОДНИМ списком, відсортованим за датою.
// Розділяти їх на два запити означало б перекласти зшивання на екран, а
// правило «сезон грибів і вечеря в четвер — обидва події цього тижня» живе в
// домені, не у фронтенді.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Repo, HouseholdEventRow, Rule, SupplyLine, Tradition } from '@kitchen/domain';
import {
  ownsEvent, occurrencesInRange, isWindowRow, yearInKitchen,
  subscribedRows, subscribedTraditions, occasionSet, isSubscribed, nowItems, buildOccasionTable, occasionWhat,
  ruleFromDates, eventWindow, OCCASION_SETS, type OccasionSet,
} from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { makeRateLimiter, type RateLimitCfg } from '../rate-limit.js';
import { tooMany } from '../too-many.js';

const DAY = 86_400_000;
// Тижневе правило розгортається по днях, тож вікно запиту має стелю. Рік
// уперед — це те, що показує стрічка профілю; більше не питає ніхто.
const MAX_RANGE_DAYS = 400;

export interface EventOccurrence {
  id: string;
  scope: 'catalog' | 'household';
  kind: string;
  title: string;
  start: number;
  end: number;
  force: 'hint' | 'restrict';
  /** П1: суворо/мʼяко словами, правило дослівно, дати включно. */
  strict?: boolean;
  rule_text?: string | null;
  from?: string | null;
  to?: string | null;
  /** Лише у власних подій: артефакт править дату на місці й мусить бачити правило. */
  rule?: Rule;
  meaning?: string;
  note?: string | null;
  restricts?: string | null;
  buy?: string[];
  seeds?: string[];
  source?: string;
  /** Чим спіймали це вікно цього року. Порожній рядок — спіймали, але чим
   *  саме, вже не памʼятаємо (старі рядки). */
  caught_by?: string;
  recipe_id?: string | null;
  servings?: number | null;
  supply?: SupplyLine[] | null;
  done_at?: string | null;
  approx?: boolean;
}

function parseDay(v: unknown, fallback: Date): Date {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return fallback;
  const [y = 1970, m = 1, d = 1] = v.split('-').map(Number);
  const out = new Date(y, m - 1, d);
  return Number.isNaN(out.getTime()) ? fallback : out;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** П1: пара дат 'YYYY-MM-DD' включно; to за замовчуванням = from. */
export function parseDates(from: unknown, to: unknown): { from: string; to: string } | null {
  if (typeof from !== 'string' || !ISO_DAY.test(from)) return null;
  const t = to == null ? from : to;
  if (typeof t !== 'string' || !ISO_DAY.test(t) || t < from) return null;
  return { from, to: t };
}

/**
 * Правило приходить із мережі, тож перевіряємо форму, а не довіряємо. Дати
 * модель не рахує ніколи — але й людина через форму може надіслати що завгодно.
 */
export function parseRule(v: unknown): Rule | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  switch (r.t) {
    case 'once': {
      if (typeof r.at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.at)) return null;
      const days = r.days == null ? undefined : Number(r.days);
      if (days != null && (!Number.isFinite(days) || days < 1 || days > 366)) return null;
      return days == null ? { t: 'once', at: r.at } : { t: 'once', at: r.at, days };
    }
    case 'weekly': {
      const dow = Number(r.dow);
      if (!Number.isInteger(dow) || dow < 0 || dow > 6) return null;
      return { t: 'weekly', dow };
    }
    // Решта форм належить глобальному довіднику: дім їх не створює, і
    // приймати їх звідси означало б дати комусь дописати собі свято.
    default:
      return null;
  }
}

export function eventsRoutes(app: FastifyInstance, repo: Repo, opts: { rateLimit?: RateLimitCfg } = {}) {
  const limiter = makeRateLimiter(opts.rateLimit ?? { max: 60, windowMs: 60_000 });
  const limitCheck = async (req: FastifyRequest, reply: FastifyReply) => {
    const { user_id } = requireUser(req);
    if (!limiter.check(user_id)) {
      tooMany(reply, limiter, user_id, 'events');
      return reply;
    }
  };

  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/v1/events',
    { preHandler: authenticated(repo) },
    async (req) => {
      const { household_id, user_id } = requireUser(req);
      const today = new Date();
      const from = parseDay(req.query.from, today);
      const to = parseDay(req.query.to, new Date(from.getTime() + 27 * DAY));
      const end = to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY
        ? new Date(from.getTime() + MAX_RANGE_DAYS * DAY)
        : to;

      // П1: довідник крізь підписку дому — сезони увімкнені, поки не
      // відписались; свята традиції — коли підписались. Традиції для
      // пасхалії — ті, чиї свята увімкнені.
      const catalog = subscribedRows(await repo.listOccasionCatalog(), await repo.listOccasionSubscriptions(household_id));
      const trads = subscribedTraditions(catalog);
      // Спіймані вікна: показуються на самій події, а не лічильником у потоці.
      const caught = new Map(
        (await repo.listOccasionCatches(household_id)).map((c) => [`${c.occasion_id}:${c.year}`, c]),
      );

      const out: EventOccurrence[] = [];

      for (const o of catalog) {
        for (const occ of occurrencesInRange(o.rule, from, end, trads)) {
          const win = isWindowRow(o) ? o : null;
          out.push({
            id: o.id,
            scope: 'catalog',
            kind: o.type,
            title: o.title,
            start: occ.start,
            end: occ.end,
            force: win?.restricts ? 'restrict' : 'hint',
            strict: !!win?.restricts,
            ...(win?.meaning ? { meaning: win.meaning } : {}),
            ...(win?.restricts ? { restricts: win.restricts } : {}),
            ...(win?.buy?.length ? { buy: win.buy } : {}),
            ...(win?.seeds?.length ? { seeds: win.seeds } : {}),
            ...(occ.approx ? { approx: true } : {}),
            // Підпис редакційної події — не оздоба: без нього «день томатів»
            // не відрізнити від свята.
            ...(o.source ? { source: o.source } : {}),
            ...(() => {
              const hit = caught.get(`${o.id}:${new Date(occ.start).getFullYear()}`);
              return hit ? { caught_by: hit.by ?? '' } : {};
            })(),
          });
        }
      }

      for (const e of await repo.listOwnEvents(household_id, user_id)) {
        for (const occ of occurrencesInRange(e.rule, from, end, trads)) {
          out.push({
            id: e.id,
            scope: 'household',
            kind: e.kind,
            title: e.title,
            start: occ.start,
            end: occ.end,
            force: e.force,
            strict: e.strict || e.force === 'restrict',
            rule_text: e.rule_text ?? null,
            from: e.from ?? null,
            to: e.to ?? null,
            rule: e.rule,
            note: e.note,
            restricts: e.restricts,
            buy: e.buy,
            recipe_id: e.recipe_id,
            servings: e.servings,
            supply: e.supply,
            done_at: e.done_at,
          });
        }
      }

      out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title, 'uk'));
      return { from: from.getTime(), to: end.getTime(), events: out };
    },
  );

  // «Не показувати» / «повернути» — те саме, що відписка від сезону: рядок
  // підписки enabled=false, назад — рядок геть (дефолт). П1 зняв заборону на
  // вимикання обмежень: піст тепер не рамка з профілю, а підписка на набір,
  // і зняти одну галочку — звичайна дія картки серії.
  app.post<{ Params: { id: string } }>(
    '/v1/events/mute/:id',
    { preHandler: [authenticated(repo), limitCheck] },
    async (req, reply) => {
      const { household_id } = requireUser(req);
      const row = (await repo.listOccasionCatalog()).find((o) => o.id === req.params.id);
      if (!row) return reply.code(404).send({ error: 'not_found' });
      await repo.setOccasionSubscription(household_id, req.params.id, false);
      return { ok: true, muted: true };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/events/mute/:id',
    { preHandler: [authenticated(repo), limitCheck] },
    async (req) => {
      const { household_id } = requireUser(req);
      await repo.setOccasionSubscription(household_id, req.params.id, null);
      return { ok: true, muted: false };
    },
  );

  // ── П1: довідник для картки серії ──────────────────────────────────────
  // Набір традиції або сезони: рядки з датами (та сама арифметика, що
  // data/occasions/table.json) і поточною галочкою — з рядка підписки або
  // дефолту.
  app.get<{ Querystring: { set?: string; year?: string } }>(
    '/v1/occasions',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { household_id } = requireUser(req);
      const set = req.query.set as OccasionSet | undefined;
      if (!set || !OCCASION_SETS.includes(set)) return reply.code(400).send({ error: 'set invalid' });
      const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
      if (!Number.isInteger(year) || year < 2000 || year > 2100) return reply.code(400).send({ error: 'year invalid' });
      const catalog = await repo.listOccasionCatalog();
      const subs = await repo.listOccasionSubscriptions(household_id);
      const rows = occasionSet(catalog, set);
      const table = buildOccasionTable(rows, [year]);
      const items = rows.map((r) => {
        const entry = table.find((e) => e.occasion_id === r.id && (set === 'seasons' || !e.tradition || e.tradition === set));
        const win = isWindowRow(r) ? r : null;
        return {
          occasion_id: r.id, title: r.title, type: r.type, tradition: r.tradition ?? null,
          from: entry?.from ?? null, to: entry?.to ?? null, ...(entry?.approx ? { approx: true } : {}),
          enabled: isSubscribed(r, subs), what: occasionWhat(r), strict: !!win?.restricts,
          ...(win?.meaning ? { meaning: win.meaning } : {}),
          ...(win?.buy?.length ? { buy: win.buy } : {}),
          ...(r.source ? { source: r.source } : {}),
        };
      }).sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''));
      return { set, year, items };
    },
  );

  // П2: календар малює «Приховані: кавуни · повернути» і «Свята: юдейські ·
  // змінити» з цього списку — тож рядок несе назву, рід і традицію з довідника.
  app.get('/v1/occasions/subscriptions', { preHandler: authenticated(repo) }, async (req) => {
    const { household_id } = requireUser(req);
    const catalog = await repo.listOccasionCatalog();
    const rows = await repo.listOccasionSubscriptions(household_id);
    return {
      subscriptions: rows.map((r) => {
        const row = catalog.find((o) => o.id === r.occasion_id);
        return {
          occasion_id: r.occasion_id, enabled: r.enabled, updated_at: r.updated_at,
          title: row?.title ?? r.occasion_id, type: row?.type ?? null, tradition: row?.tradition ?? null,
        };
      }),
    };
  });

  // Батч галочок: рядок пишеться лише як відхилення від дефолту; збіг із
  // дефолтом прибирає рядок.
  app.put<{ Body: { occasion_id?: unknown; enabled?: unknown }[] | { subscriptions?: { occasion_id?: unknown; enabled?: unknown }[] } }>(
    '/v1/occasions/subscriptions',
    { preHandler: [authenticated(repo), limitCheck] },
    async (req, reply) => {
      const { household_id } = requireUser(req);
      const list = Array.isArray(req.body) ? req.body : req.body?.subscriptions;
      if (!Array.isArray(list)) return reply.code(400).send({ error: 'subscriptions invalid' });
      const catalog = await repo.listOccasionCatalog();
      const written: { occasion_id: string; enabled: boolean }[] = [];
      for (const it of list) {
        if (!it || typeof it.occasion_id !== 'string' || typeof it.enabled !== 'boolean') {
          return reply.code(400).send({ error: 'subscriptions invalid' });
        }
        const row = catalog.find((o) => o.id === it.occasion_id);
        if (!row) return reply.code(404).send({ error: 'not_found', occasion_id: it.occasion_id });
        const enabled = it.enabled;
        await repo.setOccasionSubscription(household_id, row.id, enabled === (row.type !== 'tradition') ? null : enabled);
        written.push({ occasion_id: row.id, enabled });
      }
      const rows = await repo.listOccasionSubscriptions(household_id);
      return { written, subscriptions: rows.map((r) => ({ occasion_id: r.occasion_id, enabled: r.enabled })) };
    },
  );

  // Активні сьогодні одним контрактом — приводи крізь підписку і записи дому.
  app.get('/v1/now', { preHandler: authenticated(repo) }, async (req) => {
    const { household_id, user_id } = requireUser(req);
    const catalog = subscribedRows(await repo.listOccasionCatalog(), await repo.listOccasionSubscriptions(household_id));
    const events = await repo.listOwnEvents(household_id, user_id);
    return { now: nowItems(catalog, events, new Date()) };
  });

  app.post<{
    Body: {
      title?: string; kind?: string; rule?: unknown; note?: string | null;
      buy?: string[]; recipe_id?: string | null; servings?: number | null;
      supply?: SupplyLine[] | null; expires_at?: string | null;
      // П1: період з правилом — дати замість rule, правило дослівно, суворо.
      from?: string | null; to?: string | null; rule_text?: string | null; strict?: boolean;
    };
  }>(
    '/v1/events',
    { preHandler: [authenticated(repo), limitCheck] },
    async (req, reply) => {
      const { household_id, user_id } = requireUser(req);
      const b = req.body ?? {};
      const title = (b.title ?? '').trim();
      if (!title) return reply.code(400).send({ error: 'title required' });

      // П1: дати from/to — те саме, що rule once з тривалістю; приймаємо
      // будь-яку з форм, тримаємо обидві в згоді.
      const dates = parseDates(b.from, b.to);
      if (b.from !== undefined && !dates) return reply.code(400).send({ error: 'dates invalid' });
      const rule = dates ? ruleFromDates(dates.from, dates.to) : parseRule(b.rule);
      if (!rule) return reply.code(400).send({ error: 'rule invalid' });

      const kind = b.kind ?? 'custom';
      if (!['meal', 'supply', 'constraint', 'custom', 'diet'].includes(kind)) {
        return reply.code(400).send({ error: 'kind invalid' });
      }
      const strict = !!b.strict;
      const rule_text = (b.rule_text ?? '').trim() || null;
      // Суворо без правила — порожня обіцянка (CHECK у 0017: restrict має текст).
      if (strict && !rule_text) return reply.code(400).send({ error: 'rule_text required for strict' });
      const win = dates ?? eventWindow({ rule, from: null, to: null });

      const row: HouseholdEventRow = {
        id: randomUUID(), household_id, kind: kind as HouseholdEventRow['kind'],
        title, note: b.note ?? null, rule,
        force: strict ? 'restrict' : 'hint', restricts: strict ? rule_text : null,
        from: win?.from ?? null, to: win?.to ?? null, rule_text, strict,
        buy: b.buy ?? [], recipe_id: b.recipe_id ?? null,
        servings: b.servings ?? null, supply: b.supply ?? null,
        created_by: user_id, source: 'user',
        expires_at: b.expires_at ?? null, done_at: null,
        created_at: new Date().toISOString(),
      };
      await repo.insertHouseholdEvent(row);
      return reply.code(201).send({ event: row });
    },
  );

  app.patch<{
    Params: { id: string };
    Body: Partial<Pick<HouseholdEventRow,
      'title' | 'note' | 'buy' | 'servings' | 'supply' | 'expires_at' | 'done_at' | 'rule_text' | 'strict' | 'kind'>>
      & { rule?: unknown; from?: string | null; to?: string | null };
  }>(
    '/v1/events/:id',
    { preHandler: [authenticated(repo), limitCheck] },
    async (req, reply) => {
      const { household_id, user_id } = requireUser(req);
      const existing = await repo.getHouseholdEvent(req.params.id);
      // Чужого не бачить різниці між «немає» і «не твоє» — і не мусить. Автор
      // у перевірці, а не лише дім: календар не спільний.
      if (!ownsEvent(existing, household_id, user_id)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const b = req.body ?? {};
      const patch: Parameters<Repo['updateHouseholdEvent']>[1] = {};
      if ('title' in b) {
        const t = (b.title ?? '').trim();
        if (!t) return reply.code(400).send({ error: 'title required' });
        patch.title = t;
      }
      if ('note' in b) patch.note = b.note ?? null;
      if ('buy' in b) patch.buy = b.buy ?? [];
      if ('servings' in b) patch.servings = b.servings ?? null;
      if ('supply' in b) patch.supply = b.supply ?? null;
      if ('expires_at' in b) patch.expires_at = b.expires_at ?? null;
      if ('done_at' in b) patch.done_at = b.done_at ?? null;
      if ('rule' in b) {
        const rule = parseRule(b.rule);
        if (!rule) return reply.code(400).send({ error: 'rule invalid' });
        patch.rule = rule;
        const win = eventWindow({ rule, from: null, to: null });
        patch.from = win?.from ?? null; patch.to = win?.to ?? null;
      }
      // П1: дати правлять і правило; правило дослівно; суворо ↔ force.
      if ('from' in b || 'to' in b) {
        const cur = eventWindow(existing!);
        const dates = parseDates(b.from ?? cur?.from, b.to ?? cur?.to ?? b.from ?? cur?.from);
        if (!dates) return reply.code(400).send({ error: 'dates invalid' });
        patch.from = dates.from; patch.to = dates.to; patch.rule = ruleFromDates(dates.from, dates.to);
      }
      if ('rule_text' in b) patch.rule_text = (b.rule_text ?? '').trim() || null;
      if ('kind' in b) {
        if (!['meal', 'supply', 'constraint', 'custom', 'diet'].includes(b.kind ?? '')) return reply.code(400).send({ error: 'kind invalid' });
        patch.kind = b.kind;
      }
      if ('strict' in b || 'rule_text' in b) {
        const strict = 'strict' in b ? !!b.strict : (existing!.strict || existing!.force === 'restrict');
        const text = 'rule_text' in b ? patch.rule_text ?? null : existing!.rule_text ?? existing!.restricts;
        if (strict && !text) return reply.code(400).send({ error: 'rule_text required for strict' });
        patch.strict = strict; patch.force = strict ? 'restrict' : 'hint'; patch.restricts = strict ? text : null;
      }
      await repo.updateHouseholdEvent(req.params.id, patch);
      return { event: await repo.getHouseholdEvent(req.params.id) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/events/:id',
    { preHandler: [authenticated(repo), limitCheck] },
    async (req, reply) => {
      const { household_id, user_id } = requireUser(req);
      const existing = await repo.getHouseholdEvent(req.params.id);
      if (!ownsEvent(existing, household_id, user_id)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      await repo.deleteHouseholdEvent(req.params.id);
      return reply.code(204).send();
    },
  );

  // Одна власна подія — для артефакта в стрічці й панелі: картка знає лише
  // id, а показати мусить те саме входження, що й календар. Найближче до
  // сьогодні, якщо є; інакше останнє з минулого року (щоб «уже було» не
  // зникало з панелі). Чуже — 404, як у PATCH/DELETE.
  app.get<{ Params: { id: string } }>(
    '/v1/events/:id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { household_id, user_id } = requireUser(req);
      const e = await repo.getHouseholdEvent(req.params.id);
      if (!e || !ownsEvent(e, household_id, user_id)) return reply.code(404).send({ error: 'not_found' });
      const trads: Tradition[] = [];
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const occs = occurrencesInRange(e.rule, new Date(today.getTime() - 366 * DAY), new Date(today.getTime() + 366 * DAY), trads);
      const occ = occs.find((o) => o.end >= today.getTime()) ?? occs[occs.length - 1];
      if (!occ) return reply.code(404).send({ error: 'not_found' });
      const out: EventOccurrence = {
        id: e.id, scope: 'household', kind: e.kind, title: e.title,
        start: occ.start, end: occ.end, force: e.force, rule: e.rule,
        strict: e.strict || e.force === 'restrict', rule_text: e.rule_text ?? null, from: e.from ?? null, to: e.to ?? null,
        note: e.note, restricts: e.restricts, buy: e.buy, recipe_id: e.recipe_id,
        servings: e.servings, supply: e.supply, done_at: e.done_at,
      };
      return { event: out };
    },
  );

  // «Рік на кухні» (2.8, Д10): дванадцять смуг, спіймані залиті. Домовий
  // читач навмисно — спіймання виводиться зі спільного готування, і рік не
  // належить одній людині так, як плани.
  app.get<{ Querystring: { year?: string } }>(
    '/v1/events/year',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { household_id, user_id } = requireUser(req);
      const year = Number(req.query.year);
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return reply.code(400).send({ error: 'year invalid' });
      }
      const catalog = subscribedRows(await repo.listOccasionCatalog(), await repo.listOccasionSubscriptions(household_id));
      const catches = await repo.listOccasionCatches(household_id, year);
      return { year, strips: yearInKitchen(year, catches, subscribedTraditions(catalog), catalog) };
    },
  );
}
