// Маршрути екрана «Підписка» (спек 2026-09-25 §4). Провайдер — фейк, тож тест
// перевіряє наш бік: коли checkout дозволено, що записано ДО походу в
// провайдера, і що подія провайдера не подвоює платіж.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { FakeBillingProvider } from '../src/billing/fake-provider.js';
import { signIn } from './helpers.js';

const SECRET = 'test-billing-secret';

describe('/v1/subscription', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let billing: FakeBillingProvider;
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    process.env.BILLING_EVENT_SECRET = SECRET;
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    billing = new FakeBillingProvider();
    app = buildApp(repo, new InMemoryStore(), mailer, { billing });
    await app.ready();
  });
  afterEach(() => { delete process.env.BILLING_EVENT_SECRET; });

  const lapsed = async (cookieEmail: string) => {
    const A = await signIn(app, mailer, cookieEmail);
    const household_id = (await repo.firstHouseholdOf(A.user_id))!;
    await repo.saveSubscription({
      household_id, state: 'lapsed', plan: null, trial_used_at: null, trial_ends_at: null,
      next_charge_at: null, access_until: null, provider_order_id: null, card_mask: null, card_token: null,
      paid_by_user_id: null, deletion_warned_at: null, trial_mail_sent_at: null, updated_at: new Date().toISOString(),
    });
    return { ...A, household_id };
  };

  it('GET віддає стан і порожню історію', async () => {
    const A = await lapsed('g@example.com');
    const b = (await app.inject({ method: 'GET', url: '/v1/subscription', headers: { cookie: A.cookie } })).json();
    expect(b.subscription).toMatchObject({ state: 'lapsed', entitlement: 'read_only' });
    expect(b.payments).toEqual([]);
  });

  it('lapsed → checkout: url фейка, order_id записано ДО редиректу, пробний ще не використаний', async () => {
    const A = await lapsed('c@example.com');
    const r = await app.inject({ method: 'POST', url: '/v1/subscription/checkout', headers: { cookie: A.cookie }, payload: { plan: 'home' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().url).toContain('/fake-checkout');
    const saved = await repo.getSubscription(A.household_id);
    expect(saved?.provider_order_id).toBeTruthy();
    expect(saved?.plan).toBe('home');
    expect((billing.calls[0]!.args as { amount: number }).amount).toBe(290);
  });

  // Спек біллінгу §9.1: одна дата на два місця — у нас і в провайдера.
  it('checkout кладе trial_ends_at у підписку й те саме число віддає провайдеру', async () => {
    const A = await lapsed('c3@example.com');
    const t0 = Date.now();
    await app.inject({ method: 'POST', url: '/v1/subscription/checkout', headers: { cookie: A.cookie }, payload: { plan: 'self' } });
    const saved = await repo.getSubscription(A.household_id);
    const sent = (billing.calls[0]!.args as { date_start: string }).date_start;
    expect(saved?.trial_ends_at).toBe(sent);
    const days = (new Date(sent).getTime() - t0) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
  });

  it('пробний уже використаний → date_start «зараз», дати пробного нема', async () => {
    const A = await lapsed('c2@example.com');
    const sub = (await repo.getSubscription(A.household_id))!;
    await repo.saveSubscription({ ...sub, trial_used_at: '2026-01-01T00:00:00.000Z' });
    const t0 = Date.now();
    await app.inject({ method: 'POST', url: '/v1/subscription/checkout', headers: { cookie: A.cookie }, payload: { plan: 'self' } });
    expect((await repo.getSubscription(A.household_id))?.trial_ends_at).toBeNull();
    const sent = new Date((billing.calls[0]!.args as { date_start: string }).date_start).getTime();
    expect(Math.abs(sent - t0)).toBeLessThan(5000);
  });

  it('вже активний → 409, у провайдера нічого не питали', async () => {
    const A = await lapsed('a2@example.com');
    const sub = (await repo.getSubscription(A.household_id))!;
    await repo.saveSubscription({ ...sub, state: 'active', provider_order_id: 'o1' });
    const r = await app.inject({ method: 'POST', url: '/v1/subscription/checkout', headers: { cookie: A.cookie }, payload: { plan: 'self' } });
    expect(r.statusCode).toBe(409);
    expect(billing.calls).toHaveLength(0);
  });

  it('cancel у active → unsubscribe у провайдера, стан cancelled, доступ до дати списання', async () => {
    const A = await lapsed('x@example.com');
    const sub = (await repo.getSubscription(A.household_id))!;
    await repo.saveSubscription({ ...sub, state: 'active', plan: 'self', provider_order_id: 'o9', next_charge_at: '2026-11-01T00:00:00.000Z' });
    const r = await app.inject({ method: 'POST', url: '/v1/subscription/cancel', headers: { cookie: A.cookie }, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(billing.calls.map((c) => c.op)).toContain('unsubscribe');
    const after = await repo.getSubscription(A.household_id);
    expect(after).toMatchObject({ state: 'cancelled', access_until: '2026-11-01T00:00:00.000Z', card_mask: null });
  });

  it('тариф: підвищення одразу без дати, пониження — з датою наступного списання', async () => {
    const A = await lapsed('p@example.com');
    const sub = (await repo.getSubscription(A.household_id))!;
    await repo.saveSubscription({ ...sub, state: 'active', plan: 'self', provider_order_id: 'o7', next_charge_at: '2026-11-01T00:00:00.000Z' });
    const up = await app.inject({ method: 'POST', url: '/v1/subscription/plan', headers: { cookie: A.cookie }, payload: { plan: 'home' } });
    expect(up.json().effective_at).toBeNull();
    expect((await repo.getSubscription(A.household_id))?.plan).toBe('home');
    const down = await app.inject({ method: 'POST', url: '/v1/subscription/plan', headers: { cookie: A.cookie }, payload: { plan: 'self' } });
    expect(down.json().effective_at).toBe('2026-11-01T00:00:00.000Z');
  });

  // Подія приходить із самим order_id — дім і дата вже лежать у підписці,
  // яку записав checkout. Тому сценарій тут повний: спершу checkout.
  it('подія провайдера: subscribed → trial, success двічі → один платіж', async () => {
    const A = await lapsed('e@example.com');
    await app.inject({ method: 'POST', url: '/v1/subscription/checkout', headers: { cookie: A.cookie }, payload: { plan: 'self' } });
    const order_id = (await repo.getSubscription(A.household_id))!.provider_order_id!;
    const send = (body: unknown) => app.inject({ method: 'POST', url: '/v1/subscription/provider-event', headers: { 'x-billing-secret': SECRET }, payload: body as never });
    await send({ kind: 'subscribed', order_id, card_mask: '4242' });
    expect(await repo.getSubscription(A.household_id)).toMatchObject({ state: 'trial', card_mask: '4242' });
    await send({ kind: 'success', order_id, amount: 210, provider_payment_id: 'pay-9' });
    await send({ kind: 'success', order_id, amount: 210, provider_payment_id: 'pay-9' });
    expect((await repo.getSubscription(A.household_id))?.state).toBe('active');
    expect(await repo.listPayments(A.household_id)).toHaveLength(1);
  });

  it('подія для невідомого order → 404', async () => {
    await lapsed('e2@example.com');
    const r = await app.inject({ method: 'POST', url: '/v1/subscription/provider-event', headers: { 'x-billing-secret': SECRET }, payload: { kind: 'failure', order_id: 'нема-такого' } });
    expect(r.statusCode).toBe(404);
  });

  it('подія провайдера без секрету в заголовку → 401, без секрету в env → 503', async () => {
    await lapsed('s@example.com');
    const bad = await app.inject({ method: 'POST', url: '/v1/subscription/provider-event', headers: { 'x-billing-secret': 'nope' }, payload: { kind: 'failure', order_id: 'x' } });
    expect(bad.statusCode).toBe(401);
    delete process.env.BILLING_EVENT_SECRET;
    const off = await app.inject({ method: 'POST', url: '/v1/subscription/provider-event', payload: { kind: 'failure', order_id: 'x' } });
    expect(off.statusCode).toBe(503);
  });
});
