// Екран «Підписка» (спек 2026-09-25 §4): єдине місце платіжних дій. Бачать і
// можуть діяти ВСІ члени дому — підписка належить дому, не людині.
//
// Провайдер сховано за інтерфейсом; справжній LiqPay і його вебхук — окремий
// план біллінгу, який викликатиме той самий `applyProviderEvent`.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { applyProviderEvent, betaFlag, entitlementOf, type Plan, type ProviderEvent } from '@kitchen/domain/subscription';
import { PLAN_PRICE_UAH } from '@kitchen/domain/plans';
import { bannerFor } from '@kitchen/domain/paywall';
import { authenticated, requireUser } from '../middleware/session.js';
import type { BillingProvider } from '../billing/provider.js';

const isPlan = (p: unknown): p is Plan => p === 'self' || p === 'home';

export function subscriptionRoute(app: FastifyInstance, repo: Repo, billing: BillingProvider, appUrl: string) {
  const view = async (household_id: string) => {
    const sub = await repo.getSubscription(household_id);
    const now = new Date();
    return {
      state: sub?.state ?? (betaFlag() ? 'beta' : 'lapsed'),
      plan: sub?.plan ?? null,
      entitlement: entitlementOf(sub, now, { beta: betaFlag() }),
      trial_ends_at: sub?.trial_ends_at ?? null,
      next_charge_at: sub?.next_charge_at ?? null,
      access_until: sub?.access_until ?? null,
      card_mask: sub?.card_mask ?? null,
      banner: bannerFor(sub, now),
    };
  };

  app.get('/v1/subscription', { preHandler: authenticated(repo) }, async (req) => {
    const { household_id } = requireUser(req);
    return { subscription: await view(household_id), payments: await repo.listPayments(household_id) };
  });

  app.post<{ Body: { plan?: Plan } }>('/v1/subscription/checkout', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id, household_id } = requireUser(req);
    const plan = req.body?.plan;
    if (!isPlan(plan)) return reply.code(400).send({ error: 'plan' });
    const sub = await repo.getSubscription(household_id);
    // Спек §7: двоє з дому тиснуть «Оформити» одночасно — другий відсікається
    // ще до провайдера, щойно стан перестав бути «нема доступу».
    const open = !sub ? !betaFlag() : ['lapsed', 'cancelled', 'past_due'].includes(sub.state);
    if (!open) return reply.code(409).send({ error: 'already_active' });
    const order_id = randomUUID();
    // Записуємо order_id ДО походу в провайдера: інакше вебхук повернеться
    // раніше за нас і не знайде, якому дому він належить.
    await repo.saveSubscription({
      household_id, state: sub?.state ?? 'lapsed', plan,
      trial_used_at: sub?.trial_used_at ?? null, trial_ends_at: sub?.trial_ends_at ?? null,
      next_charge_at: sub?.next_charge_at ?? null, access_until: sub?.access_until ?? null,
      provider_order_id: order_id, card_mask: sub?.card_mask ?? null, paid_by_user_id: user_id,
      deletion_warned_at: null, trial_mail_sent_at: sub?.trial_mail_sent_at ?? null,
      updated_at: new Date().toISOString(),
    });
    const url = await billing.checkoutUrl({
      order_id, household_id, plan, amount: PLAN_PRICE_UAH[plan],
      // Пробний — один раз на дім.
      trial: !sub?.trial_used_at,
      result_url: `${appUrl}/profile/subscription?order=${order_id}`,
    });
    return { url };
  });

  app.post('/v1/subscription/cancel', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { household_id } = requireUser(req);
    const sub = await repo.getSubscription(household_id);
    if (!sub?.provider_order_id || !['trial', 'active', 'past_due'].includes(sub.state)) {
      return reply.code(409).send({ error: 'nothing_to_cancel' });
    }
    await billing.unsubscribe(sub.provider_order_id);
    await repo.saveSubscription(applyProviderEvent(sub, { kind: 'unsubscribed', order_id: sub.provider_order_id }, new Date()).sub);
    return { subscription: await view(household_id) };
  });

  app.post<{ Body: { plan?: Plan } }>('/v1/subscription/plan', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { household_id } = requireUser(req);
    const plan = req.body?.plan;
    if (!isPlan(plan)) return reply.code(400).send({ error: 'plan' });
    const sub = await repo.getSubscription(household_id);
    if (!sub?.provider_order_id || !['trial', 'active'].includes(sub.state) || sub.plan === plan) {
      return reply.code(409).send({ error: 'cannot_change' });
    }
    await billing.updateAmount(sub.provider_order_id, PLAN_PRICE_UAH[plan]);
    await repo.saveSubscription({ ...sub, plan, updated_at: new Date().toISOString() });
    // Підвищення діє одразу; пониження — з наступного списання, і саме цю
    // дату екран показує людині.
    return { subscription: await view(household_id), effective_at: plan === 'home' ? null : sub.next_charge_at };
  });

  // Тільки для стенда й тестів: справжній вебхук LiqPay (підпис, мапінг
  // статусів) — план біллінгу; він кликатиме ті самі applyProviderEvent +
  // insertPayment.
  app.post<{ Body: ProviderEvent }>('/v1/subscription/provider-event', async (req, reply) => {
    const secret = process.env.BILLING_EVENT_SECRET;
    if (!secret) return reply.code(503).send({ error: 'billing_events_not_configured' });
    if (req.headers['x-billing-secret'] !== secret) return reply.code(401).send({ error: 'forbidden' });
    const ev = req.body;
    const sub = ev.kind === 'subscribed'
      ? (await repo.findSubscriptionByOrder(ev.order_id)) ?? (await repo.getSubscription(ev.household_id))
      : await repo.findSubscriptionByOrder(ev.order_id);
    if (!sub && ev.kind !== 'subscribed') return reply.code(404).send({ error: 'unknown_order' });
    const r = applyProviderEvent(sub, ev, new Date());
    await repo.saveSubscription(r.sub);
    // Ідемпотентність подвійного вебхука — на рівні repo (UNIQUE по
    // provider_payment_id), тут нічого перевіряти не треба.
    if (r.payment) await repo.insertPayment(r.payment);
    return { ok: true, state: r.sub.state };
  });
}
