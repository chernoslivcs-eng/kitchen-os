// Біллінг: вебхук провайдера й оформлення з лендінга до реєстрації
// (спек 2026-09-25-billing-liqpay-design.md §2, §6; провайдер — план mono).
//
// Тут три входи з трьома різними моделями довіри, і плутати їх не можна:
//   /v1/billing/intent — взагалі без довіри, лише ліміт по IP;
//   /v1/billing/bind   — звичайна сесія.
// Вебхук провайдера живе окремо (mono-webhook), бо йому потрібне сире тіло.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { INTENT_TTL_DAYS, applyProviderEvent, trialEndsFrom, type Plan } from '@kitchen/domain/subscription';
import { PLAN_PRICE_UAH } from '@kitchen/domain/plans';
import { authenticated, requireUser } from '../middleware/session.js';
import { makeRateLimiter } from '../rate-limit.js';
import type { BillingProvider } from '../billing/provider.js';

const DAY = 86_400_000;
const isPlan = (p: unknown): p is Plan => p === 'self' || p === 'home';

export function billingRoutes(app: FastifyInstance, repo: Repo, billing: BillingProvider, appUrl: string) {
  // Оформлення з лендінга: людини ще немає, тож єдиний запобіжник — IP.
  const intentLimiter = makeRateLimiter({ max: 10, windowMs: 60 * 60_000 });
  app.post<{ Body: { plan?: Plan } }>('/v1/billing/intent', async (req, reply) => {
    const plan = req.body?.plan;
    if (!isPlan(plan)) return reply.code(400).send({ error: 'plan' });
    if (!intentLimiter.check(req.ip)) {
      return reply.code(429).header('retry-after', String(intentLimiter.retryAfter(req.ip))).send({ error: 'too_many' });
    }
    const now = new Date();
    const order_id = randomUUID();
    const trial_ends_at = trialEndsFrom(now);
    // Намір пишеться ДО походу в провайдера з тієї ж причини, що й order_id у
    // checkout: вебхук повертається раніше, ніж людина бачить сторінку.
    await repo.insertIntent({
      order_id, plan, state: 'pending', trial_ends_at, card_mask: null, card_token: null, household_id: null,
      ip: req.ip ?? null, created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + INTENT_TTL_DAYS * DAY).toISOString(), bound_at: null,
    });
    const url = await billing.checkoutUrl({
      order_id, household_id: null, plan, amount: PLAN_PRICE_UAH[plan],
      // Дому ще немає — гаманцем служить сам намір. Після bind картка вже
      // привʼязана токеном, і walletId ролі не грає.
      wallet_id: order_id,
      result_url: `${appUrl}/?intent=${order_id}#l3-signin`,
    });
    // order_id віддаємо разом з адресою: він уже є всередині result_url, але
    // лендінг має покласти його собі ДО того, як людина піде в оплату. Хто
    // закрив вкладку замість повернення по result_url, інакше лишається без
    // жодного способу привʼязати сплачене.
    return { url, order_id };
  });

  app.post<{ Body: { order_id?: string } }>('/v1/billing/bind', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id, household_id } = requireUser(req);
    const order_id = req.body?.order_id;
    if (!order_id) return reply.code(400).send({ error: 'order_id' });
    const intent = await repo.getIntent(order_id);
    if (!intent) return reply.code(404).send({ error: 'unknown_intent' });
    if (intent.state === 'expired') return reply.code(410).send({ error: 'intent_expired' });
    if (intent.state === 'bound') return reply.code(409).send({ error: 'already_bound' });
    // Вебхук ще не прийшов — не помилка: клієнт спитає ще раз (спек §6).
    if (intent.state === 'pending') return reply.code(202).send({ status: 'pending' });

    const sub = await repo.getSubscription(household_id);
    if (sub && ['trial', 'active', 'past_due'].includes(sub.state)) {
      // Дім уже платить: другу картку в провайдера лишати не можна — з неї
      // колись спишуть гроші за те, чим людина вже користується.
      if (intent.card_token) await billing.deleteToken(intent.card_token);
      await repo.updateIntent(order_id, { state: 'expired' });
      return reply.code(409).send({ error: 'already_subscribed' });
    }

    const now = new Date();
    // Дата — з наміру як є: саме в неї крон зробить перше списання, навіть
    // якщо дім свій пробний уже витратив.
    //
    // Токен переїжджає сюди ж: картку токенізували до того, як зʼявився дім,
    // і тепер це єдине, чим крон зможе з неї списати.
    const r = applyProviderEvent(sub, {
      kind: 'subscribed', household_id, order_id, plan: intent.plan,
      card_mask: intent.card_mask, card_token: intent.card_token,
      trial_ends_at: intent.trial_ends_at, paid_by_user_id: user_id,
    }, now);
    await repo.saveSubscription(r.sub);
    await repo.updateIntent(order_id, { state: 'bound', household_id, bound_at: now.toISOString() });
    return { subscription: { state: r.sub.state, plan: r.sub.plan, trial_ends_at: r.sub.trial_ends_at, next_charge_at: r.sub.next_charge_at, card_mask: r.sub.card_mask } };
  });
}
