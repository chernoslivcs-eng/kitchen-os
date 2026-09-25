// Маршрути біллінгу (спек §2, §6). Ключі LiqPay тут є лише в env тесту —
// мережі немає, провайдер фейковий, підпис справжній.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { FakeBillingProvider } from '../src/billing/fake-provider.js';
import { liqpayEncode, liqpaySign } from '../src/billing/liqpay.js';
import { signIn } from './helpers.js';

const KEY = 'test-private-key';

describe('/v1/billing', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let billing: FakeBillingProvider;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    process.env.LIQPAY_PRIVATE_KEY = KEY;
    process.env.LIQPAY_PUBLIC_KEY = 'test-public-key';
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    billing = new FakeBillingProvider();
    app = buildApp(repo, new InMemoryStore(), mailer, { billing });
    await app.ready();
  });
  afterEach(() => { delete process.env.LIQPAY_PRIVATE_KEY; delete process.env.LIQPAY_PUBLIC_KEY; });

  const callback = (payload: object) => {
    const data = liqpayEncode(payload);
    return app.inject({
      method: 'POST', url: '/v1/billing/liqpay',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ data, signature: liqpaySign(KEY, data) }).toString(),
    });
  };

  const makeIntent = async (plan: 'self' | 'home' = 'home') => {
    const r = await app.inject({ method: 'POST', url: '/v1/billing/intent', payload: { plan } });
    return { r, order_id: (await repo.listIntentsExpiring(new Date('2100-01-01'))).at(-1)!.order_id };
  };

  describe('вебхук', () => {
    it('без ключа в env — 503, нічого не розбираємо', async () => {
      delete process.env.LIQPAY_PRIVATE_KEY;
      expect((await callback({ status: 'success', order_id: 'x' })).statusCode).toBe(503);
    });

    it('підпис не збігся — 403', async () => {
      const data = liqpayEncode({ status: 'success', order_id: 'x' });
      const r = await app.inject({
        method: 'POST', url: '/v1/billing/liqpay',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ data, signature: 'підроблений' }).toString(),
      });
      expect(r.statusCode).toBe(403);
    });

    it('проміжний статус — 200 і жодної дії', async () => {
      const r = await callback({ status: 'wait_secure', order_id: 'x' });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ ignored: true });
    });

    it('subscribed для наміру → намір позначено, маска збережена', async () => {
      const { order_id } = await makeIntent();
      const r = await callback({ status: 'subscribed', order_id, sender_card_mask2: '4242' });
      expect(r.statusCode).toBe(200);
      expect(await repo.getIntent(order_id)).toMatchObject({ state: 'subscribed', card_mask: '4242' });
    });

    it('невідомий order — 200, щоб LiqPay не молотив повтори вічно', async () => {
      const r = await callback({ status: 'failure', order_id: randomUUID() });
      expect(r.statusCode).toBe(200);
      expect(r.json().result).toMatchObject({ target: 'none', reason: 'unknown_order' });
    });
  });

  describe('намір', () => {
    it('створюється БЕЗ сесії, пишеться до походу в провайдера, віддає url', async () => {
      const { r, order_id } = await makeIntent('self');
      expect(r.statusCode).toBe(200);
      expect(r.json().url).toContain('/fake-checkout');
      const intent = await repo.getIntent(order_id);
      expect(intent).toMatchObject({ plan: 'self', state: 'pending' });
      // дата пробного — та сама, що пішла в провайдера
      expect((billing.calls[0]!.args as { date_start: string }).date_start).toBe(intent!.trial_ends_at);
      expect((billing.calls[0]!.args as { household_id: string | null }).household_id).toBeNull();
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
      await callback({ status: 'subscribed', order_id, sender_card_mask2: '7777' });
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
      await callback({ status: 'subscribed', order_id, sender_card_mask2: '1' });
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
        card_mask: null, paid_by_user_id: null, deletion_warned_at: null, trial_mail_sent_at: null,
        updated_at: new Date().toISOString(),
      });
      const { order_id } = await makeIntent();
      await callback({ status: 'subscribed', order_id, sender_card_mask2: '1' });
      const r = await bind(A.cookie, order_id);
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ error: 'already_subscribed' });
      expect(billing.calls.some((c) => c.op === 'unsubscribe' && c.args === order_id)).toBe(true);
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
