// Три ендпоінти для запрошень у дім.
//   POST /v1/households/:household_id/invite   { email, role? }
//     тільки учасники дому — 403 інакше; ліміт 20/год на user_id
//   POST /v1/invites/:id/revoke
//     тільки автор запрошення
//   GET  /v1/invites/accept?token=<raw>
//     БЕЗ авторизації — лінк сам по собі є входом; на успіху ставить cookie,
//     той самий 'kos', що й після magic-link

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Repo, HouseholdRole } from '@kitchen/domain';
import { createInvite, acceptInvite, inviteInfo, INVITE_TTL_MS, SESSION_TTL_MS } from '@kitchen/domain';
import type { Mailer } from '../mailer.js';
import { COOKIE_NAME } from './auth.js';
import { authenticated, requireUser } from '../middleware/session.js';
import { makeRateLimiter, type RateLimitCfg } from '../rate-limit.js';

function isSecure(): boolean {
  return process.env.NODE_ENV === 'production';
}

function baseUrl(): string {
  return process.env.APP_URL ?? 'http://localhost:3000';
}

export interface InvitesRoutesOpts {
  rateLimit?: RateLimitCfg;
}

export function invitesRoutes(app: FastifyInstance, repo: Repo, mailer: Mailer, opts: InvitesRoutesOpts = {}) {
  const cfg = opts.rateLimit ?? { max: 20, windowMs: 60 * 60_000 };
  const limiter = makeRateLimiter(cfg);

  const limitCheck = async (req: FastifyRequest, reply: FastifyReply) => {
    const key = (req as { user?: { user_id: string } }).user?.user_id ?? req.ip;
    if (!limiter.check(key)) {
      reply.code(429).send({ error: 'too many requests' });
      return reply;
    }
  };

  app.post<{
    Params: { household_id: string };
    Body: { email?: string; role?: HouseholdRole };
  }>(
    '/v1/households/:household_id/invite',
    { preHandler: [authenticated(repo), limitCheck] },     // порядок: спочатку сесія, потім ліміт по user_id
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const { household_id } = req.params;
      const email = req.body?.email?.trim().toLowerCase();
      const role = req.body?.role ?? 'member';
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return reply.code(400).send({ error: 'valid email required' });
      }
      if (!(await repo.isMember(household_id, user_id))) {
        return reply.code(403).send({ error: 'not a member of this household' });
      }
      const { invite, raw_token } = await createInvite(repo, {
        household_id, invited_by: user_id, email, role,
      });
      // Пул-5 №2: лист веде на фронтову сторінку — там людина бачить, куди її
      // запрошують, і приймає явним кліком. Токен споживається тільки тоді.
      const link = `${baseUrl()}/invite?token=${encodeURIComponent(raw_token)}`;
      // Пул-8: мертвий мейлер (Resend без домену) — не привід валити роут:
      // запрошення створене, лінк повертаємо власнику, він передасть сам.
      // Сирий токен живе тільки в цій відповіді (у БД — хеш), тому лінк
      // віддається рівно раз — у момент створення.
      let mail_sent = true;
      try {
        await mailer.sendMagicLink({
          to: email,
          link,
          expires_in_min: Math.round(INVITE_TTL_MS / 60_000),
        });
      } catch (err) {
        mail_sent = false;
        app.log.warn({ err, email }, 'invite mail failed — link returned to owner');
      }
      return reply.code(201).send({
        id: invite.id,
        household_id: invite.household_id,
        email: invite.email,
        role: invite.role,
        expires_at: invite.expires_at,
        link,
        mail_sent,
      });
    },
  );

  app.get<{ Params: { household_id: string } }>(
    '/v1/households/:household_id/invites',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const { household_id } = req.params;
      if (!(await repo.isMember(household_id, user_id))) {
        return reply.code(403).send({ error: 'not a member of this household' });
      }
      const invites = await repo.listInvitesForHousehold(household_id);
      // Не витікаємо token_hash — це серверний секрет. Клієнту потрібні лише
      // метадані запрошень.
      const safe = invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        created_at: i.created_at,
        expires_at: i.expires_at,
        consumed_at: i.consumed_at,
        revoked_at: i.revoked_at,
      }));
      return { invites: safe };
    },
  );

  // PATCH /v1/households/:hid/members/:uid — змінити роль учасника.
  // Тільки власник може підвищувати або знижувати. Останній власник не може
  // сам собі забрати роль — інакше дім лишиться без хазяїна.
  app.patch<{
    Params: { household_id: string; user_id: string };
    Body: { role?: 'owner' | 'member' };
  }>('/v1/households/:household_id/members/:user_id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const actor = requireUser(req);
      const { household_id, user_id: target } = req.params;
      const nextRole = req.body?.role;
      if (nextRole !== 'owner' && nextRole !== 'member') {
        return reply.code(400).send({ error: 'role_invalid' });
      }
      const actorRole = await repo.roleOf(household_id, actor.user_id);
      if (actorRole !== 'owner') return reply.code(403).send({ error: 'only_owner_can_change_roles' });
      const targetRole = await repo.roleOf(household_id, target);
      if (!targetRole) return reply.code(404).send({ error: 'not_a_member' });
      if (targetRole === 'owner' && nextRole === 'member') {
        const members = await repo.listMembersOfHousehold(household_id);
        const owners = members.filter((m) => m.role === 'owner');
        if (owners.length <= 1) {
          return reply.code(409).send({ error: 'last_owner_cannot_downgrade', hint: 'promote_someone_first' });
        }
      }
      await repo.setMemberRole(household_id, target, nextRole);
      return { updated: true, role: nextRole };
    },
  );

  // DELETE /v1/households/:hid/members/:uid — виключити учасника з дому.
  // Правила: власник може виключити будь-кого, крім себе. Учасник може виключити
  // сам себе. Ніхто не може виключити останнього власника — це залишить дім без
  // хазяїна; спершу треба передати роль (окрема майбутня операція).
  app.delete<{ Params: { household_id: string; user_id: string } }>(
    '/v1/households/:household_id/members/:user_id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const actor = requireUser(req);
      const { household_id, user_id: target } = req.params;

      const actorRole = await repo.roleOf(household_id, actor.user_id);
      if (!actorRole) return reply.code(403).send({ error: 'not_a_member' });

      const targetRole = await repo.roleOf(household_id, target);
      if (!targetRole) return reply.code(404).send({ error: 'not_a_member' });

      // Тільки власник може видаляти інших. Учасник — тільки себе.
      if (actor.user_id !== target && actorRole !== 'owner') {
        return reply.code(403).send({ error: 'only_owner_can_remove_others' });
      }

      if (targetRole === 'owner') {
        const members = await repo.listMembersOfHousehold(household_id);
        const owners = members.filter((m) => m.role === 'owner');
        if (owners.length <= 1) {
          return reply.code(409).send({ error: 'last_owner_cannot_leave', hint: 'transfer_ownership_first' });
        }
      }

      await repo.removeMember(household_id, target);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/invites/:id/revoke',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const inv = await repo.getInvite(req.params.id);
      if (!inv) return reply.code(404).send({ error: 'invite not found' });
      if (inv.invited_by !== user_id) return reply.code(403).send({ error: 'forbidden' });
      if (inv.revoked_at || inv.consumed_at) return reply.code(409).send({ error: 'already closed' });
      await repo.revokeInvite(inv.id);
      return reply.code(204).send();
    },
  );

  // Read-only інфо для сторінки /invite: без побічних ефектів, скільки завгодно разів.
  app.get<{ Querystring: { token?: string } }>('/v1/invites/info', async (req, reply) => {
    const raw = req.query.token;
    if (!raw) return reply.code(400).send({ error: 'token required' });
    const info = await inviteInfo(repo, raw);
    if (!info) return reply.code(404).send({ error: 'invite not available' });
    return reply.send(info);
  });

  app.get<{ Querystring: { token?: string; next?: string } }>('/v1/invites/accept', async (req, reply) => {
    const raw = req.query.token;
    if (!raw) return reply.code(400).send({ error: 'token required' });
    // Браузерний клік по старому лінку з листа — НЕ споживаємо токен, ведемо
    // на сторінку рішення. Програмний accept (фронт/тести) іде без text/html.
    const wantsHtml = /text\/html/i.test(String(req.headers.accept ?? ''));
    if (wantsHtml) return reply.redirect(`/invite?token=${encodeURIComponent(raw)}`);
    const out = await acceptInvite(repo, raw, req.ip, req.headers['user-agent'] ?? null);
    if (!out.ok) {
      const code = out.reason === 'expired' ? 410
        : out.reason === 'consumed' ? 410
        : out.reason === 'revoked' ? 410
        : 404;
      return reply.code(code).send({ error: out.reason });
    }
    reply.setCookie(COOKIE_NAME, out.result.raw_cookie, {
      httpOnly: true,
      secure: isSecure(),
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });
    const next = req.query.next;
    if (next && next.startsWith('/')) return reply.redirect(next);
    return reply.send({
      ok: true,
      user_id: out.result.user_id,
      household_id: out.result.household_id,
      role: out.result.role,
      already_member: out.result.already_member,
    });
  });
}
