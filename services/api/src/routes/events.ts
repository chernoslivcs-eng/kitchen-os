// GET    /v1/events?from&to  → { events } — глобальні й домашні одним списком
// POST   /v1/events          → створити подію дому
// PATCH  /v1/events/:id      → правка
// DELETE /v1/events/:id      → 204
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
import type { Repo, HouseholdEventRow, Rule, SupplyLine } from '@kitchen/domain';
import { ownsEvent, occurrencesInRange, traditionsOf, isWindowRow, yearInKitchen } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { makeRateLimiter, type RateLimitCfg } from '../rate-limit.js';

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
      reply.code(429).send({ error: 'too many requests' });
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

      // Традиція не поле профілю, а висновок із побажань — те саме правило, що
      // в контексті промпта. Довідник без неї віддає самі сезони.
      const profile = await repo.getProfile(user_id);
      const trads = traditionsOf(profile);
      // «Не показувати такі» — рішення людини про свій календар, і воно старше
      // за будь-який привід.
      const muted = new Set(await repo.listMutedOccasions(user_id));
      // Спіймані вікна: показуються на самій події, а не лічильником у потоці.
      const caught = new Map(
        (await repo.listOccasionCatches(household_id)).map((c) => [`${c.occasion_id}:${c.year}`, c]),
      );

      const out: EventOccurrence[] = [];

      for (const o of await repo.listOccasionCatalog()) {
        if (muted.has(o.id)) continue;
        if (o.tradition && !trads.includes(o.tradition)) continue;
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

  // Вимкнути редакційну подію й повернути її назад.
  //
  // Обмеження вимкнути НЕ можна: піст — рамка, яку людина сама на себе взяла
  // побажанням у профілі, і «не показувати» тут означало б тихо скасувати
  // сказане. Знімається воно там, де ставилось — у побажаннях.
  app.post<{ Params: { id: string } }>(
    '/v1/events/mute/:id',
    { preHandler: [authenticated(repo), limitCheck] },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const row = (await repo.listOccasionCatalog()).find((o) => o.id === req.params.id);
      if (!row) return reply.code(404).send({ error: 'not_found' });
      if (isWindowRow(row) && row.restricts) {
        return reply.code(409).send({ error: 'restriction_not_mutable' });
      }
      await repo.muteOccasion(user_id, req.params.id);
      return { ok: true, muted: true };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/events/mute/:id',
    { preHandler: [authenticated(repo), limitCheck] },
    async (req) => {
      const { user_id } = requireUser(req);
      await repo.unmuteOccasion(user_id, req.params.id);
      return { ok: true, muted: false };
    },
  );

  app.post<{
    Body: {
      title?: string; kind?: string; rule?: unknown; note?: string | null;
      buy?: string[]; recipe_id?: string | null; servings?: number | null;
      supply?: SupplyLine[] | null; expires_at?: string | null;
    };
  }>(
    '/v1/events',
    { preHandler: [authenticated(repo), limitCheck] },
    async (req, reply) => {
      const { household_id, user_id } = requireUser(req);
      const b = req.body ?? {};
      const title = (b.title ?? '').trim();
      if (!title) return reply.code(400).send({ error: 'title required' });

      const rule = parseRule(b.rule);
      if (!rule) return reply.code(400).send({ error: 'rule invalid' });

      const kind = b.kind ?? 'custom';
      if (!['meal', 'supply', 'constraint', 'custom'].includes(kind)) {
        return reply.code(400).send({ error: 'kind invalid' });
      }

      const row: HouseholdEventRow = {
        id: randomUUID(), household_id, kind: kind as HouseholdEventRow['kind'],
        title, note: b.note ?? null, rule,
        // Обмеження дім собі не пише: піст приходить із довідника, а «тверда
        // межа» без тексту обмеження — порожня обіцянка. CHECK у 0017 тримає
        // той самий інваріант з боку БД.
        force: 'hint', restricts: null,
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
      'title' | 'note' | 'buy' | 'servings' | 'supply' | 'expires_at' | 'done_at'>> & { rule?: unknown };
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
      const profile = await repo.getProfile(user_id);
      const trads = traditionsOf(profile);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const occs = occurrencesInRange(e.rule, new Date(today.getTime() - 366 * DAY), new Date(today.getTime() + 366 * DAY), trads);
      const occ = occs.find((o) => o.end >= today.getTime()) ?? occs[occs.length - 1];
      if (!occ) return reply.code(404).send({ error: 'not_found' });
      const out: EventOccurrence = {
        id: e.id, scope: 'household', kind: e.kind, title: e.title,
        start: occ.start, end: occ.end, force: e.force, rule: e.rule,
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
      const profile = await repo.getProfile(user_id);
      const trads = traditionsOf(profile);
      const catalog = await repo.listOccasionCatalog();
      const catches = await repo.listOccasionCatches(household_id, year);
      return { year, strips: yearInKitchen(year, catches, trads, catalog) };
    },
  );
}
