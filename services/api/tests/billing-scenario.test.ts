// Наскрізний сценарій наміру (план §Task 8): людина платить З ЛЕНДІНГА, ДО
// того як у неї зʼявився акаунт, а дім народжується вже після оплати.
//
// Кожен шматок цього шляху перевірений окремо. Але ціна помилки тут — гроші
// списані з картки за дім, якого немає, тому шлях проходиться цілком і тими
// самими маршрутами, якими ходить людина: намір, колбек провайдера, вхід,
// привʼязка, перше справжнє списання через два тижні.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { FakeBillingProvider } from '../src/billing/fake-provider.js';
import { runBillingCron } from '../src/billing-cron.js';
import { PLAN_PRICE_UAH } from '@kitchen/domain/plans';
import { signIn } from './helpers.js';

const SECRET = 'stand-secret';
const DAY = 86_400_000;

describe('намір → оплата → вхід → привʼязка', () => {
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

  const event = (body: object) => app.inject({
    method: 'POST', url: '/v1/subscription/provider-event',
    headers: { 'x-billing-secret': SECRET }, payload: body,
  });

  it('дім отримує пробний з датою наміру; далі списує крон, а не провайдер', async () => {
    // 1. Лендінг: наміру передують лише план і IP.
    const started = await app.inject({ method: 'POST', url: '/v1/billing/intent', payload: { plan: 'home' } });
    expect(started.statusCode).toBe(200);
    const { order_id, url } = started.json() as { order_id: string; url: string };
    expect(url).toContain(encodeURIComponent(order_id));

    const fresh = await repo.getIntent(order_id);
    expect(fresh).toMatchObject({ state: 'pending', household_id: null });
    const trialEnds = fresh!.trial_ends_at!;
    // Дата пробного рахується ОДИН раз — тут. Далі вона лише переноситься.
    expect(new Date(trialEnds).getTime() - Date.now()).toBeGreaterThan(13 * DAY);

    // 2. Провайдер підтвердив картку. Дому ще немає — подія лягає в намір.
    const paid = await event({ kind: 'subscribed', order_id, card_mask: '4242', card_token: 'tok-1' });
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({ result: { target: 'intent' } });
    expect(await repo.getIntent(order_id)).toMatchObject({ state: 'subscribed', card_mask: '4242', card_token: 'tok-1' });

    // 3. Людина заходить уперше — дім народжується зараз.
    const me = await signIn(app, mailer, 'newcomer@local.test');
    expect(await repo.getSubscription(me.household_id)).toBeNull();

    // 4. Привʼязка: єдине місце, де намір зустрічається з домом.
    const bound = await app.inject({
      method: 'POST', url: '/v1/billing/bind', headers: { cookie: me.cookie }, payload: { order_id },
    });
    expect(bound.statusCode).toBe(200);

    const sub = await repo.getSubscription(me.household_id);
    expect(sub).toMatchObject({
      state: 'trial', plan: 'home', card_mask: '4242',
      // Токен переїхав із наміру: саме ним крон спише через два тижні.
      card_token: 'tok-1',
      provider_order_id: order_id, paid_by_user_id: me.user_id,
      // Дата з наміру, не перерахована наново: саме в неї крон спише.
      // Розбіжність тут = лист бреше про списання.
      trial_ends_at: trialEnds, next_charge_at: trialEnds,
    });
    expect(await repo.getIntent(order_id)).toMatchObject({ state: 'bound', household_id: me.household_id });

    // 5. Крон наміру більше не бачить: привʼязаний не прострочується.
    const quiet = await runBillingCron({ repo, mailer, billing, appUrl: 'http://app.test', now: () => new Date(Date.now() + DAY) });
    expect(quiet.intentsExpired).toBe(0);
    expect(billing.calls.filter((c) => c.op === 'delete-token')).toHaveLength(0);
    // Пробний ще триває — грошей теж не чіпаємо.
    expect(quiet.charged).toBe(0);

    // 6. Настав кінець пробного: списує НАШ крон, не провайдер.
    const cron = await runBillingCron({ repo, mailer, billing, appUrl: 'http://app.test', now: () => new Date(trialEnds) });
    expect(cron.charged).toBe(1);
    expect(billing.calls).toContainEqual({ op: 'charge', args: { card_token: 'tok-1', amount: PLAN_PRICE_UAH.home, reference: order_id } });
    expect(await repo.getSubscription(me.household_id)).toMatchObject({ state: 'active' });
    expect(await repo.listPayments(me.household_id)).toMatchObject([{ status: 'success', amount: PLAN_PRICE_UAH.home }]);

    // 7. Людина скасувала: картка прибрана у провайдера, токен стерто в нас.
    const cancelled = await app.inject({ method: 'POST', url: '/v1/subscription/cancel', headers: { cookie: me.cookie } });
    expect(cancelled.statusCode).toBe(200);
    expect(billing.calls).toContainEqual({ op: 'delete-token', args: 'tok-1' });
    expect(await repo.getSubscription(me.household_id)).toMatchObject({ state: 'cancelled', card_token: null });

    // 8. І з цієї миті крон такий дім у чергу на списання не бере.
    const after = await runBillingCron({ repo, mailer, billing, appUrl: 'http://app.test', now: () => new Date(Date.now() + 60 * DAY) });
    expect(after.charged).toBe(0);
  });

  it('людина не дійшла до входу — крон відписує картку за неї', async () => {
    const started = await app.inject({ method: 'POST', url: '/v1/billing/intent', payload: { plan: 'self' } });
    const { order_id } = started.json() as { order_id: string };
    await event({ kind: 'subscribed', order_id, card_mask: '4242', card_token: 'tok-lost' });

    const cron = await runBillingCron({ repo, mailer, billing, appUrl: 'http://app.test', now: () => new Date(Date.now() + 8 * DAY) });
    expect(cron.intentsExpired).toBe(1);
    // Інакше картка лишилась би збереженою в mono назавжди — за акаунтом,
    // якого так і не з'явилось.
    expect(billing.calls).toContainEqual({ op: 'delete-token', args: 'tok-lost' });
    expect(await repo.getIntent(order_id)).toMatchObject({ state: 'expired' });
  });
});
