// GET /v1/me
//   Хто зайшов, у якому активному домі, хто ще в тому домі.
//   Мінімальний контракт для фронту — «показати шапку/профіль».
//   Мультидомна логіка (перемикач) — окремим кроком.

import type { FastifyInstance } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { COOKIE_NAME } from './auth.js';
import { betaFlag, entitlementOf } from '@kitchen/domain/subscription';
import { bannerFor } from '@kitchen/domain/paywall';

export function meRoute(app: FastifyInstance, repo: Repo) {
  app.get('/v1/me', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id, household_id, session_id } = requireUser(req);
    const [user, household, members, role, telegram, sub] = await Promise.all([
      repo.getUser(user_id),
      repo.getHousehold(household_id),
      repo.listMembersOfHousehold(household_id),
      repo.roleOf(household_id, user_id),
      repo.getTelegramByUser(user_id),
      repo.getSubscription(household_id),
    ]);
    if (!user || !household) return reply.code(404).send({ error: 'user or household missing' });
    const now = new Date();
    return {
      user: { id: user.id, name: user.name, email: user.email, plan: user.plan, welcome_seen_at: user.welcome_seen_at },
      household: {
        id: household.id,
        name: household.name,
        role,
        members: members.map((m) => ({
          user_id: m.user_id,
          name: m.name,
          role: m.role,
          joined_at: m.joined_at,
        })),
      },
      session_id,
      // Шерінг v3: «Надіслати в Telegram» на /share — лише коли є жива привʼязка (для всіх, не лише без пошти).
      telegram_linked: !!telegram && !telegram.revoked_at,
      // Режим без підписки (спек 2026-09-25 §1, §3). Рахує сервер: і право
      // (`entitlement`), і готовий текст банера. Клієнт лише малює — інакше
      // дві половини розійдуться в тому, що людина зараз може.
      subscription: {
        state: sub?.state ?? (betaFlag() ? 'beta' : 'lapsed'),
        plan: sub?.plan ?? null,
        entitlement: entitlementOf(sub, now, { beta: betaFlag() }),
        trial_ends_at: sub?.trial_ends_at ?? null,
        /**
         * Чи дасть НОВЕ оформлення пробний період. Та сама умова, що в
         * checkout (`sub?.trial_used_at ? null : …`), і клієнту вона потрібна
         * не для краси: текст перед сторінкою банку обіцяє або «перше списання
         * {дата}», або «протягом доби». Без цього поля екран «Підписка» не
         * може відрізнити ці випадки й обіцяв би людині не те.
         */
        trial_available: !sub?.trial_used_at,
        next_charge_at: sub?.next_charge_at ?? null,
        access_until: sub?.access_until ?? null,
        card_mask: sub?.card_mask ?? null,
        banner: bannerFor(sub, now),
      },
    };
  });

  // Раунд 4, крок 7 (AUDIT-NEXT-STEPS): «бачив Семена» — на сервері, по
  // акаунту; localStorage у клієнта — лише кеш.
  app.patch<{ Body: { welcome_seen?: boolean } }>(
    '/v1/me',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      if (req.body?.welcome_seen !== true) return reply.code(400).send({ error: 'nothing_to_patch' });
      const at = new Date().toISOString();
      await repo.touchUser(user_id, 'welcome_seen_at', at);
      return { welcome_seen_at: at };
    },
  );

  // Пул-5 №1: повне видалення акаунта. Опитувальник — до видалення (щоб мати
  // email), сам delete зносить доми-де-єдиний-член каскадами. 204 і мертва кука.
  app.delete<{ Body: { reason?: string; comment?: string } }>(
    '/v1/me',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const user = await repo.getUser(user_id);
      if (user) {
        // PR 1 (0036): акаунт із Telegram без пошти — у зошит виходу йде його Telegram-id.
        const tg = user.email ? null : await repo.getTelegramByUser(user_id);
        await repo.recordExitSurvey({
          email: user.email ?? `telegram:${tg?.telegram_user_id ?? user_id}`,
          reason: (req.body?.reason ?? '').trim() || 'unspecified',
          comment: req.body?.comment?.trim() || null,
        });
      }
      await repo.deleteUserAccount(user_id);
      reply.clearCookie(COOKIE_NAME, { path: '/' });
      return reply.code(204).send();
    },
  );
}
