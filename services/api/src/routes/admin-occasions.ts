// Адмінка v0 (фаза 4): «день томатів» без деплою.
//
// Навмисно вужча за схему occasion_catalog. Тільки kind='editorial' — сезони
// й свята лишаються фактами коду (BUILTIN_OCCASIONS), не контентом редакції,
// і ризик кривого запису через довільну форму того не вартий. Тільки
// rule.t='window' — той самий вибір, що зробив parseRule() для дому: інші
// форми належать релігійному календарю, а не одноразовому «дню томатів».
// tradition і audience не виставляються — NULL завжди, «усім», що й було
// пʼятим пунктом самого першого запиту на цю фічу.
//
// Створення завжди дає чернетку: published_at виставляє лише окрема дія.
// Це той самий принцип, що в household_occasion_mute, — два способи сказати
// одне (тут: «опубліковано» булевим полем ПЛЮС датою) були б розбіжністю,
// що чекає свого часу.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Repo, AdminOccasionRow } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { requireAdmin } from '../middleware/admin.js';
import { makeRateLimiter, type RateLimitCfg } from '../rate-limit.js';

const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

interface WindowInput {
  from?: unknown;
  to?: unknown;
}

function parseWindow(v: unknown): { t: 'window'; from: string; to: string } | null {
  if (!v || typeof v !== 'object') return null;
  const { from, to } = v as WindowInput;
  if (typeof from !== 'string' || !MONTH_DAY_RE.test(from)) return null;
  if (typeof to !== 'string' || !MONTH_DAY_RE.test(to)) return null;
  return { t: 'window', from, to };
}

function parseStrings(v: unknown): string[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return null;
  return v as string[];
}

export function adminOccasionsRoutes(app: FastifyInstance, repo: Repo, opts: { rateLimit?: RateLimitCfg } = {}) {
  const limiter = makeRateLimiter(opts.rateLimit ?? { max: 60, windowMs: 60_000 });
  const guard = [authenticated(repo), requireAdmin(repo), async (req: FastifyRequest, reply: FastifyReply) => {
    const { user_id } = requireUser(req);
    if (!limiter.check(user_id)) {
      reply.code(429).send({ error: 'too many requests' });
      return reply;
    }
  }];

  app.get('/v1/admin/occasions', { preHandler: guard }, async () => {
    return { occasions: await repo.listAdminOccasions() };
  });

  app.post<{
    Body: {
      id?: string; title?: string; meaning?: string; rule?: unknown;
      buy?: unknown; seeds?: unknown; upcoming_title?: string | null; source?: string;
    };
  }>('/v1/admin/occasions', { preHandler: guard }, async (req, reply) => {
    const b = req.body ?? {};
    const id = (b.id ?? '').trim().toLowerCase();
    if (!ID_RE.test(id)) return reply.code(400).send({ error: 'id invalid: a-z0-9-, 2-64 chars' });
    const existing = (await repo.listAdminOccasions()).find((o) => o.id === id);
    if (existing) return reply.code(409).send({ error: 'id already exists' });

    const title = (b.title ?? '').trim();
    if (!title) return reply.code(400).send({ error: 'title required' });
    const meaning = (b.meaning ?? '').trim();
    if (!meaning) return reply.code(400).send({ error: 'meaning required' });
    const source = (b.source ?? '').trim();
    // Обовʼязкове (Д5): редакційна подія від першого дня видимо підписана —
    // інакше вона непомітно стає рекламним каналом, а не приводом.
    if (!source) return reply.code(400).send({ error: 'source required' });

    const rule = parseWindow(b.rule);
    if (!rule) return reply.code(400).send({ error: 'rule invalid: {from,to} у форматі MM-DD' });
    const buy = parseStrings(b.buy);
    if (!buy) return reply.code(400).send({ error: 'buy invalid' });
    const seeds = parseStrings(b.seeds);
    if (!seeds) return reply.code(400).send({ error: 'seeds invalid' });

    const row: AdminOccasionRow = {
      id, kind: 'editorial', title, meaning, rule, buy, seeds,
      upcoming_title: b.upcoming_title?.trim() || null,
      source, published_at: null, created_at: new Date().toISOString(),
    };
    await repo.upsertAdminOccasion(row);
    return reply.code(201).send({ occasion: row });
  });

  app.patch<{
    Params: { id: string };
    Body: {
      title?: string; meaning?: string; rule?: unknown;
      buy?: unknown; seeds?: unknown; upcoming_title?: string | null; source?: string;
    };
  }>('/v1/admin/occasions/:id', { preHandler: guard }, async (req, reply) => {
    const existing = (await repo.listAdminOccasions()).find((o) => o.id === req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    const b = req.body ?? {};
    const next: AdminOccasionRow = { ...existing };
    if ('title' in b) {
      const t = (b.title ?? '').trim();
      if (!t) return reply.code(400).send({ error: 'title required' });
      next.title = t;
    }
    if ('meaning' in b) {
      const m = (b.meaning ?? '').trim();
      if (!m) return reply.code(400).send({ error: 'meaning required' });
      next.meaning = m;
    }
    if ('source' in b) {
      const s = (b.source ?? '').trim();
      if (!s) return reply.code(400).send({ error: 'source required' });
      next.source = s;
    }
    if ('rule' in b) {
      const rule = parseWindow(b.rule);
      if (!rule) return reply.code(400).send({ error: 'rule invalid: {from,to} у форматі MM-DD' });
      next.rule = rule;
    }
    if ('buy' in b) {
      const buy = parseStrings(b.buy);
      if (!buy) return reply.code(400).send({ error: 'buy invalid' });
      next.buy = buy;
    }
    if ('seeds' in b) {
      const seeds = parseStrings(b.seeds);
      if (!seeds) return reply.code(400).send({ error: 'seeds invalid' });
      next.seeds = seeds;
    }
    if ('upcoming_title' in b) next.upcoming_title = b.upcoming_title?.trim() || null;

    await repo.upsertAdminOccasion(next);
    return { occasion: next };
  });

  app.post<{ Params: { id: string } }>('/v1/admin/occasions/:id/publish', { preHandler: guard }, async (req, reply) => {
    const existing = (await repo.listAdminOccasions()).find((o) => o.id === req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    await repo.setOccasionPublished(req.params.id, true);
    return { ok: true, published: true };
  });

  app.post<{ Params: { id: string } }>('/v1/admin/occasions/:id/unpublish', { preHandler: guard }, async (req, reply) => {
    const existing = (await repo.listAdminOccasions()).find((o) => o.id === req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    await repo.setOccasionPublished(req.params.id, false);
    return { ok: true, published: false };
  });

  app.delete<{ Params: { id: string } }>('/v1/admin/occasions/:id', { preHandler: guard }, async (req, reply) => {
    const existing = (await repo.listAdminOccasions()).find((o) => o.id === req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    await repo.deleteAdminOccasion(req.params.id);
    return reply.code(204).send();
  });
}
