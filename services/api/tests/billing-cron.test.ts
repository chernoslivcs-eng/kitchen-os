// Щоденний крон біллінгу (спек 2026-09-25 §5, §6). Головна вимога — ідемпотентність:
// крон ходить щодня, а лист людина має отримати один раз.
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryRepo, type AuthSession } from '@kitchen/domain';
import { ConsoleMailer } from '../src/mailer.js';
import { runBillingCron } from '../src/billing-cron.js';
import { FakeBillingProvider } from '../src/billing/fake-provider.js';

const sub = (household_id: string, p: Record<string, unknown>) => ({
  household_id, state: 'active', plan: 'self', trial_used_at: null, trial_ends_at: null,
  next_charge_at: null, access_until: null, provider_order_id: 'o', card_mask: '4242', card_token: null,
  paid_by_user_id: null, deletion_warned_at: null, trial_mail_sent_at: null,
  updated_at: '2026-09-01T00:00:00.000Z', ...p,
}) as never;

const seen = (repo: InMemoryRepo, user_id: string, at: string) => repo.saveSession({
  id: randomUUID(), user_id, cookie_hash: randomUUID(), created_at: at, last_seen_at: at,
  expires_at: '2030-01-01T00:00:00.000Z', revoked_at: null, ip: null, user_agent: null,
} as AuthSession);

const at = (repo: InMemoryRepo, mailer: ConsoleMailer, d: string) =>
  ({ repo, mailer, appUrl: 'http://app.test', now: () => new Date(d) });

describe('runBillingCron', () => {
  it('cancelled після дати → lapsed і лист один раз', async () => {
    const repo = new InMemoryRepo(); const mailer = new ConsoleMailer();
    const { household_id } = await repo.createUserWithHousehold('a@x.test', 'A');
    await repo.saveSubscription(sub(household_id, { state: 'cancelled', access_until: '2026-10-01T00:00:00.000Z' }));
    const deps = at(repo, mailer, '2026-10-01T03:30:00.000Z');
    expect((await runBillingCron(deps)).transitions).toBe(1);
    expect((await repo.getSubscription(household_id))?.state).toBe('lapsed');
    expect(mailer.plain.map((m) => m.subject)).toEqual(['Підписка закінчилась — усе на місці']);
    await runBillingCron(deps);
    expect(mailer.plain).toHaveLength(1);
  });

  it('лист за 3 дні до кінця пробного — раз, із сумою тарифу', async () => {
    const repo = new InMemoryRepo(); const mailer = new ConsoleMailer();
    const { household_id } = await repo.createUserWithHousehold('b@x.test', 'B');
    await repo.saveSubscription(sub(household_id, { state: 'trial', plan: 'home', trial_ends_at: '2026-10-04T00:00:00.000Z', next_charge_at: '2026-10-04T00:00:00.000Z' }));
    const deps = at(repo, mailer, '2026-10-01T03:30:00.000Z');
    await runBillingCron(deps);
    await runBillingCron(deps);
    expect(mailer.plain).toHaveLength(1);
    expect(mailer.plain[0]!.text).toContain('спишеться 290 ₴');
  });

  it('тиша пів року → попередження; вхід скидає відлік; далі знову попередження і видалення', async () => {
    const repo = new InMemoryRepo(); const mailer = new ConsoleMailer();
    const { user_id, household_id } = await repo.createUserWithHousehold('c@x.test', 'C');
    await seen(repo, user_id, '2026-01-01T00:00:00.000Z');
    await repo.saveSubscription(sub(household_id, { state: 'lapsed', access_until: '2026-01-15T00:00:00.000Z' }));

    expect((await runBillingCron(at(repo, mailer, '2026-07-20T03:30:00.000Z'))).warnings).toBe(1);
    expect((await repo.getSubscription(household_id))?.deletion_warned_at).toBeTruthy();

    await seen(repo, user_id, '2026-08-01T00:00:00.000Z');   // зайшов після попередження
    expect((await runBillingCron(at(repo, mailer, '2026-08-25T03:30:00.000Z'))).deleted).toBe(0);
    expect((await repo.getSubscription(household_id))?.deletion_warned_at).toBeNull();

    expect((await runBillingCron(at(repo, mailer, '2027-03-10T03:30:00.000Z'))).warnings).toBe(1);
    expect((await runBillingCron(at(repo, mailer, '2027-04-15T03:30:00.000Z'))).deleted).toBe(1);
    expect(await repo.getHousehold(household_id)).toBeNull();
  });

  it('акаунт без пошти: лист нікуди не йде, повідомлення — у бот', async () => {
    const repo = new InMemoryRepo(); const mailer = new ConsoleMailer();
    const made = await repo.createUserFromTelegram({ telegram_user_id: 9001, chat_id: 9001, name: 'Т' });
    await repo.saveSubscription(sub(made.household_id, { state: 'cancelled', access_until: '2026-10-01T00:00:00.000Z' }));
    const notes: string[] = [];
    await runBillingCron({ ...at(repo, mailer, '2026-10-01T03:30:00.000Z'), telegramNotify: async (_u: string, text: string) => { notes.push(text); } });
    expect(mailer.plain).toHaveLength(0);
    expect(notes).toHaveLength(1);
  });
});

// Спек біллінгу §2: намір без привʼязки живе 7 днів. Далі його треба прибрати
// — і, якщо картка вже дана, відписати в провайдера, інакше з неї колись
// спишуть за акаунт, якого не існує.
describe('runBillingCron · прострочені наміри', () => {
  const intent = (order_id: string, over: Record<string, unknown> = {}) => ({
    order_id, plan: 'home' as const, state: 'pending' as const, trial_ends_at: '2026-10-19T00:00:00.000Z',
    card_mask: null, card_token: null, household_id: null, ip: null, created_at: '2026-10-01T00:00:00.000Z',
    expires_at: '2026-10-08T00:00:00.000Z', bound_at: null, ...over,
  });
  const deps = (repo: InMemoryRepo, mailer: ConsoleMailer, billing: FakeBillingProvider) =>
    ({ repo, mailer, billing, appUrl: 'http://app.test', now: () => new Date('2026-10-09T03:30:00.000Z') });

  it('pending → expired без походу в провайдера', async () => {
    const repo = new InMemoryRepo(); const billing = new FakeBillingProvider();
    await repo.insertIntent(intent('ord-p'));
    const r = await runBillingCron(deps(repo, new ConsoleMailer(), billing));
    expect(r.intentsExpired).toBe(1);
    expect(await repo.getIntent('ord-p')).toMatchObject({ state: 'expired' });
    expect(billing.calls).toHaveLength(0);
  });

  it('subscribed → токен видалено й expired', async () => {
    const repo = new InMemoryRepo(); const billing = new FakeBillingProvider();
    await repo.insertIntent(intent('ord-s', { state: 'subscribed', card_mask: '4242', card_token: 'tok-s' }));
    const r = await runBillingCron(deps(repo, new ConsoleMailer(), billing));
    expect(r.intentsExpired).toBe(1);
    expect(billing.calls).toEqual([{ op: 'delete-token', args: 'tok-s' }]);
    expect(await repo.getIntent('ord-s')).toMatchObject({ state: 'expired' });
  });

  it('привʼязаний і ще живий — не чіпаємо', async () => {
    const repo = new InMemoryRepo(); const billing = new FakeBillingProvider();
    await repo.insertIntent(intent('ord-b', { state: 'bound' }));
    await repo.insertIntent(intent('ord-f', { expires_at: '2027-01-01T00:00:00.000Z' }));
    const r = await runBillingCron(deps(repo, new ConsoleMailer(), billing));
    expect(r.intentsExpired).toBe(0);
    expect(billing.calls).toHaveLength(0);
  });

  it('провайдер упав на одному намірі — решта все одно прибрана', async () => {
    const repo = new InMemoryRepo();
    const billing = new FakeBillingProvider();
    billing.deleteToken = async (t: string) => { if (t === 'tok-bad') throw new Error('mono down'); };
    await repo.insertIntent(intent('ord-bad', { state: 'subscribed', card_token: 'tok-bad' }));
    await repo.insertIntent(intent('ord-ok', { state: 'subscribed', card_token: 'tok-ok' }));
    const r = await runBillingCron(deps(repo, new ConsoleMailer(), billing));
    expect(r.intentsExpired).toBe(1);
    expect(await repo.getIntent('ord-bad')).toMatchObject({ state: 'subscribed' });
    expect(await repo.getIntent('ord-ok')).toMatchObject({ state: 'expired' });
  });
});

// Крок списання (план mono, задача 4). У mono підписки немає: щомісячні гроші
// знімає саме крон, і помилитись тут дорожче, ніж будь-де ще в біллінгу.
describe('runBillingCron · списання за токеном', () => {
  const due = async (over: Record<string, unknown> = {}) => {
    const repo = new InMemoryRepo();
    const { household_id } = await repo.createUserWithHousehold(`${randomUUID()}@x.test`, 'D');
    await repo.saveSubscription(sub(household_id, {
      state: 'trial', plan: 'home', trial_ends_at: '2026-10-15T00:00:00.000Z',
      next_charge_at: '2026-10-15T00:00:00.000Z', card_token: 'tok-1', provider_order_id: 'ord-1', ...over,
    }));
    return { repo, household_id };
  };
  const run = (repo: InMemoryRepo, billing: FakeBillingProvider, day = '2026-10-15T03:30:00.000Z') =>
    runBillingCron({ repo, mailer: new ConsoleMailer(), billing, appUrl: 'http://app.test', now: () => new Date(day) });

  it('настав час → списано, дім active, платіж записано', async () => {
    const { repo, household_id } = await due();
    const billing = new FakeBillingProvider();
    const r = await run(repo, billing);
    expect(r.charged).toBe(1);
    // Сума — за тарифом дому, у гривнях: у копійки переводить адаптер.
    expect(billing.calls).toContainEqual({ op: 'charge', args: { card_token: 'tok-1', amount: 290, reference: 'ord-1' } });
    expect(await repo.getSubscription(household_id)).toMatchObject({ state: 'active' });
    expect(await repo.listPayments(household_id)).toMatchObject([{ status: 'success', amount: 290 }]);
  });

  it('час ще не настав — не чіпаємо', async () => {
    const { repo } = await due();
    const billing = new FakeBillingProvider();
    expect((await run(repo, billing, '2026-10-14T03:30:00.000Z')).charged).toBe(0);
    expect(billing.calls).toHaveLength(0);
  });

  it('токена немає — списувати нічим, у чергу не беремо', async () => {
    const { repo } = await due({ card_token: null });
    const billing = new FakeBillingProvider();
    expect((await run(repo, billing)).charged).toBe(0);
    expect(billing.calls).toHaveLength(0);
  });

  it('другий прогін того самого дня не списує вдруге', async () => {
    const { repo } = await due();
    const billing = new FakeBillingProvider();
    await run(repo, billing);
    const again = await run(repo, billing);
    expect(again.charged).toBe(0);
    expect(billing.calls.filter((c) => c.op === 'charge')).toHaveLength(1);
  });

  it('невдача → past_due і рядок платежу failure', async () => {
    const { repo, household_id } = await due();
    const billing = new FakeBillingProvider(); billing.nextCharge = 'failure';
    const r = await run(repo, billing);
    expect(r.charged).toBe(0);
    expect(r.chargeFailures).toBe(1);
    expect(await repo.getSubscription(household_id)).toMatchObject({ state: 'past_due' });
    expect(await repo.listPayments(household_id)).toMatchObject([{ status: 'failure' }]);
  });

  it('processing → чекаємо вебхук, стану не міняємо', async () => {
    const { repo, household_id } = await due();
    const billing = new FakeBillingProvider(); billing.nextCharge = 'processing';
    const r = await run(repo, billing);
    expect(r.charged).toBe(0);
    expect(await repo.getSubscription(household_id)).toMatchObject({ state: 'trial' });
    expect(await repo.listPayments(household_id)).toHaveLength(0);
  });

  it('past_due повторюємо три дні, четвертого — тиша', async () => {
    const { repo } = await due({ state: 'past_due' });
    const billing = new FakeBillingProvider(); billing.nextCharge = 'failure';
    for (const d of ['2026-10-16', '2026-10-17', '2026-10-18']) {
      expect((await run(repo, billing, `${d}T03:30:00.000Z`)).chargeFailures).toBe(1);
    }
    // 15-го + 3 доби вичерпано: далі мовчимо до lapsed на сьомий день.
    expect((await run(repo, billing, '2026-10-19T03:30:00.000Z')).chargeFailures).toBe(0);
    expect(billing.calls.filter((c) => c.op === 'charge')).toHaveLength(3);
  });

  it('провайдер упав — решта домів усе одно списується', async () => {
    const { repo } = await due();
    const { household_id: h2 } = await repo.createUserWithHousehold('two@x.test', 'T');
    await repo.saveSubscription(sub(h2, {
      state: 'active', plan: 'self', next_charge_at: '2026-10-15T00:00:00.000Z',
      card_token: 'tok-bad', provider_order_id: 'ord-2',
    }));
    const billing = new FakeBillingProvider();
    billing.chargeByToken = async (i) => { if (i.card_token === 'tok-bad') throw new Error('mono down'); return { provider_payment_id: 'x', status: 'success' }; };
    const r = await run(repo, billing);
    expect(r.charged).toBe(1);
    expect(await repo.getSubscription(h2)).toMatchObject({ state: 'active', next_charge_at: '2026-10-15T00:00:00.000Z' });
  });

  it('скасований дім не списуємо, навіть якщо дата минула', async () => {
    const { repo } = await due({ state: 'cancelled', access_until: '2026-11-01T00:00:00.000Z' });
    const billing = new FakeBillingProvider();
    expect((await run(repo, billing)).charged).toBe(0);
    expect(billing.calls).toHaveLength(0);
  });
});

