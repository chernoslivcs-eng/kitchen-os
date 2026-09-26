// Завершення бети (план 2026-09-25, Task 13): разова дія в день запуску оплат.
// Усі доми, що жили безкоштовно, отримують 7 днів попередження й лист; далі їх
// підхоплює щоденний крон і переводить у read_only.
import { describe, it, expect } from 'vitest';
import { InMemoryRepo } from '@kitchen/domain';
import { ConsoleMailer } from '../src/mailer.js';
import { planEndBeta, applyEndBeta, END_BETA_GRACE_DAYS } from '../src/billing-end-beta.js';
import { runBillingCron } from '../src/billing-cron.js';

const NOW = new Date('2026-11-01T09:00:00.000Z');
const PLUS7 = '2026-11-08T09:00:00.000Z';

async function two() {
  const repo = new InMemoryRepo();
  const a = await repo.createUserWithHousehold('a@x.test', 'A');   // без рядка підписки
  const b = await repo.createUserWithHousehold('b@x.test', 'B');   // явний beta
  await repo.saveSubscription({
    household_id: b.household_id, state: 'beta', plan: null, trial_used_at: null, trial_ends_at: null,
    next_charge_at: null, access_until: null, provider_order_id: null, card_mask: null, card_token: null, paid_by_user_id: null,
    deletion_warned_at: null, trial_mail_sent_at: null, updated_at: NOW.toISOString(),
  });
  return { repo, a, b };
}

describe('planEndBeta', () => {
  it('бачить обидва доми — і з рядком beta, і зовсім без рядка', async () => {
    const { repo, a, b } = await two();
    const plan = await planEndBeta(repo, NOW);
    expect(plan.map((p) => p.household_id).sort()).toEqual([a.household_id, b.household_id].sort());
    expect(plan.every((p) => p.access_until === PLUS7)).toBe(true);
    expect(END_BETA_GRACE_DAYS).toBe(7);
  });

  it('не чіпає тих, хто вже платить', async () => {
    const { repo, b } = await two();
    const sub = (await repo.getSubscription(b.household_id))!;
    await repo.saveSubscription({ ...sub, state: 'active', plan: 'self', provider_order_id: 'o1' });
    expect((await planEndBeta(repo, NOW)).map((p) => p.household_id)).not.toContain(b.household_id);
  });
});

describe('applyEndBeta', () => {
  it('обидва доми → cancelled з доступом на 7 днів, по листу кожному', async () => {
    const { repo, a, b } = await two();
    const mailer = new ConsoleMailer();
    const r = await applyEndBeta({ repo, mailer, appUrl: 'http://app.test', now: () => NOW });
    expect(r).toMatchObject({ households: 2, mails: 2 });
    for (const h of [a.household_id, b.household_id]) {
      expect(await repo.getSubscription(h)).toMatchObject({ state: 'cancelled', plan: null, access_until: PLUS7 });
    }
    expect(mailer.plain.map((m) => m.subject)).toEqual([
      'Через 7 днів у Kitchen OS запускається оплата',
      'Через 7 днів у Kitchen OS запускається оплата',
    ]);
  });

  it('повторний запуск нічого не міняє й нікому не пише', async () => {
    const { repo } = await two();
    const mailer = new ConsoleMailer();
    await applyEndBeta({ repo, mailer, appUrl: 'http://app.test', now: () => NOW });
    const again = await applyEndBeta({ repo, mailer, appUrl: 'http://app.test', now: () => NOW });
    expect(again).toMatchObject({ households: 0, mails: 0 });
    expect(mailer.plain).toHaveLength(2);
  });

  it('через 7 днів щоденний крон доводить їх до read_only — без окремого коду', async () => {
    const { repo, a } = await two();
    const mailer = new ConsoleMailer();
    await applyEndBeta({ repo, mailer, appUrl: 'http://app.test', now: () => NOW });
    const after = await runBillingCron({ repo, mailer, appUrl: 'http://app.test', now: () => new Date('2026-11-08T09:00:01.000Z') });
    expect(after.transitions).toBe(2);
    expect((await repo.getSubscription(a.household_id))?.state).toBe('lapsed');
  });

  it('акаунт без пошти отримує те саме в бот', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    await repo.createUserFromTelegram({ telegram_user_id: 5150, chat_id: 5150, name: 'Т' });
    const notes: string[] = [];
    const r = await applyEndBeta({ repo, mailer, appUrl: 'http://app.test', now: () => NOW, telegramNotify: async (_u, text) => { notes.push(text); } });
    expect(r).toMatchObject({ households: 1, mails: 0, notes: 1 });
    expect(notes[0]).toContain('8 листопада');
  });
});
