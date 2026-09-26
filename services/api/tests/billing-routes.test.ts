// Маршрути біллінгу (спек §2, §6): намір із лендінга й привʼязка після входу.
// Вебхук провайдера — у mono-webhook.test.ts: йому потрібне сире тіло й підпис.
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { FakeBillingProvider } from '../src/billing/fake-provider.js';
import { signIn } from './helpers.js';

const EVENT_SECRET = 'stand-secret';

describe('/v1/billing', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let billing: FakeBillingProvider;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    process.env.BILLING_EVENT_SECRET = EVENT_SECRET;
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    billing = new FakeBillingProvider();
    app = buildApp(repo, new InMemoryStore(), mailer, { billing });
    await app.ready();
  });


  // Провайдер підтвердив картку. Йдемо через стендовий маршрут подій, а не
  // через вебхук: підпис і сире тіло — тема mono-webhook.test.ts.
  const subscribed = (order_id: string, card_mask: string) => app.inject({
    method: 'POST', url: '/v1/subscription/provider-event',
    headers: { 'x-billing-secret': EVENT_SECRET },
    payload: { kind: 'subscribed', order_id, card_mask, card_token: `tok-${order_id.slice(0, 6)}` },
  });

  const makeIntent = async (plan: 'self' | 'home' = 'home') => {
    const r = await app.inject({ method: 'POST', url: '/v1/billing/intent', payload: { plan } });
    return { r, order_id: (await repo.listIntentsExpiring(new Date('2100-01-01'))).at(-1)!.order_id };
  };

  describe('намір', () => {
    it('створюється БЕЗ сесії, пишеться до походу в провайдера, віддає url', async () => {
      const { r, order_id } = await makeIntent('self');
      expect(r.statusCode).toBe(200);
      expect(r.json().url).toContain('/fake-checkout');
      const intent = await repo.getIntent(order_id);
      expect(intent).toMatchObject({ plan: 'self', state: 'pending' });
      // Дата пробного нікуди не їде: списує наш крон, провайдер її не знає.
      expect(intent!.trial_ends_at).not.toBeNull();
      expect(billing.calls[0]!.args).not.toHaveProperty('date_start');
      expect((billing.calls[0]!.args as { household_id: string | null }).household_id).toBeNull();
      // Дому ще немає — гаманцем служить сам намір.
      expect((billing.calls[0]!.args as { wallet_id: string }).wallet_id).toBe(order_id);
    });

    it('тариф не з списку — 400', async () => {
      expect((await app.inject({ method: 'POST', url: '/v1/billing/intent', payload: { plan: 'безкоштовно' } })).statusCode).toBe(400);
    });

    it('ліміт по IP — 429 після десятого', async () => {
      for (let i = 0; i < 10; i++) await app.inject({ method: 'POST', url: '/v1/billing/intent', payload: { plan: 'self' } });
      expect((await app.inject({ method: 'POST', url: '/v1/billing/intent', payload: { plan: 'self' } })).statusCode).toBe(429);
    });
  });

  describe('привʼязка після входу', () => {
    const bind = (cookie: string, order_id: string) =>
      app.inject({ method: 'POST', url: '/v1/billing/bind', headers: { cookie }, payload: { order_id } });

    it('невідомий намір — 404', async () => {
      const A = await signIn(app, mailer, 'b1@example.com');
      expect((await bind(A.cookie, randomUUID())).statusCode).toBe(404);
    });

    it('намір ще pending (вебхук не прийшов) — 202', async () => {
      const A = await signIn(app, mailer, 'b2@example.com');
      const { order_id } = await makeIntent();
      const r = await bind(A.cookie, order_id);
      expect(r.statusCode).toBe(202);
      expect(r.json()).toMatchObject({ status: 'pending' });
    });

    it('subscribed → підписка дому з датою НАМІРУ, намір bound', async () => {
      const A = await signIn(app, mailer, 'b3@example.com');
      const { order_id } = await makeIntent('home');
      await subscribed(order_id, '7777');
      const r = await bind(A.cookie, order_id);
      expect(r.statusCode).toBe(200);
      const household_id = (await repo.firstHouseholdOf(A.user_id))!;
      const intent = await repo.getIntent(order_id);
      expect(await repo.getSubscription(household_id)).toMatchObject({
        state: 'trial', plan: 'home', card_mask: '7777',
        trial_ends_at: intent!.trial_ends_at, provider_order_id: order_id, paid_by_user_id: A.user_id,
      });
      expect(intent).toMatchObject({ state: 'bound', household_id });
    });

    it('той самий намір удруге — 409 already_bound', async () => {
      const A = await signIn(app, mailer, 'b4@example.com');
      const { order_id } = await makeIntent();
      await subscribed(order_id, '1');
      await bind(A.cookie, order_id);
      const r = await bind(A.cookie, order_id);
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ error: 'already_bound' });
    });

    it('у дому вже є підписка — 409 і намір відписано в провайдера', async () => {
      const A = await signIn(app, mailer, 'b5@example.com');
      const household_id = (await repo.firstHouseholdOf(A.user_id))!;
      await repo.saveSubscription({
        household_id, state: 'active', plan: 'self', trial_used_at: null, trial_ends_at: null,
        next_charge_at: '2026-12-01T00:00:00.000Z', access_until: null, provider_order_id: 'старий',
        card_mask: null, card_token: null, paid_by_user_id: null, deletion_warned_at: null, trial_mail_sent_at: null,
        updated_at: new Date().toISOString(),
      });
      const { order_id } = await makeIntent();
      await subscribed(order_id, '1');
      const r = await bind(A.cookie, order_id);
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ error: 'already_subscribed' });
      // Картка наміру прибрана у провайдера: з неї вже нічого не спишуть.
      expect(billing.calls.some((c) => c.op === 'delete-token')).toBe(true);
      expect(await repo.getIntent(order_id)).toMatchObject({ state: 'expired' });
      expect((await repo.getSubscription(household_id))?.provider_order_id).toBe('старий');
    });

    it('протухлий намір — 410', async () => {
      const A = await signIn(app, mailer, 'b6@example.com');
      const { order_id } = await makeIntent();
      await repo.updateIntent(order_id, { state: 'expired' });
      expect((await bind(A.cookie, order_id)).statusCode).toBe(410);
    });

    it('без сесії — 401', async () => {
      const { order_id } = await makeIntent();
      expect((await app.inject({ method: 'POST', url: '/v1/billing/bind', payload: { order_id } })).statusCode).toBe(401);
    });
  });
});
