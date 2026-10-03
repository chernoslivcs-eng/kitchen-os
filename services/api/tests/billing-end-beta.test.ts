// Завершення бети (спек 2026-10-01 §3): разова дія в день деплою демо. Усі
// доми, що жили безкоштовно, переходять у `demo` на 7 днів і отримують
// стартове повідомлення; далі їх підхоплює щоденний крон і переводить у
// read_only — тим самим кодом, що й решту станів.
import { describe, it, expect } from 'vitest';
import { InMemoryRepo } from '@kitchen/domain';
import { ConsoleMailer } from '../src/mailer.js';
import { planEndBeta, applyEndBeta } from '../src/billing-end-beta.js';
import { DEMO_DAYS } from '@kitchen/domain/subscription';
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
    deletion_warned_at: null, trial_mail_sent_at: null, demo_ends_at: null, demo_mail_sent_at: null, updated_at: NOW.toISOString(),
  });
  return { repo, a, b };
}

describe('planEndBeta', () => {
  it('бачить обидва доми — і з рядком beta, і зовсім без рядка', async () => {
    const { repo, a, b } = await two();
    const plan = await planEndBeta(repo, NOW);
    expect(plan.map((p) => p.household_id).sort()).toEqual([a.household_id, b.household_id].sort());
    expect(plan.every((p) => p.demo_ends_at === PLUS7)).toBe(true);
    expect(DEMO_DAYS).toBe(7);
  });

  it('не чіпає тих, хто вже платить', async () => {
    const { repo, b } = await two();
    const sub = (await repo.getSubscription(b.household_id))!;
    await repo.saveSubscription({ ...sub, state: 'active', plan: 'self', provider_order_id: 'o1' });
    expect((await planEndBeta(repo, NOW)).map((p) => p.household_id)).not.toContain(b.household_id);
  });
});

describe('applyEndBeta', () => {
  it('обидва доми → demo на 7 днів, по листу кожному', async () => {
    const { repo, a, b } = await two();
    const mailer = new ConsoleMailer();
    const r = await applyEndBeta({ repo, mailer, appUrl: 'http://app.test', now: () => NOW });
    expect(r).toMatchObject({ households: 2, mails: 2 });
    for (const h of [a.household_id, b.household_id]) {
      expect(await repo.getSubscription(h)).toMatchObject({
        state: 'demo', plan: null, demo_ends_at: PLUS7,
        // Демо = використаний пробний: ці доми вже не отримають 14 днів із
        // карткою, і підписка в них створить active, а не trial.
        trial_used_at: NOW.toISOString(),
      });
    }
    expect(mailer.plain.map((m) => m.subject)).toEqual(['Можна починати з кухні', 'Можна починати з кухні']);
  });

  it('повторний запуск нічого не міняє й нікому не пише', async () => {
    const { repo } = await two();
    const mailer = new ConsoleMailer();
    await applyEndBeta({ repo, mailer, appUrl: 'http://app.test', now: () => NOW });
    const again = await applyEndBeta({ repo, mailer, appUrl: 'http://app.test', now: () => NOW });
    expect(again).toMatchObject({ households: 0, mails: 0 });
    expect(mailer.plain).toHaveLength(2);
  });

  it('дім, якому демо вже дали, другого разу не отримує', async () => {
    const { repo } = await two();
    const mailer = new ConsoleMailer();
    await applyEndBeta({ repo, mailer, appUrl: 'http://app.test', now: () => NOW });
    // Через тиждень хтось запускає скрипт ще раз: доми вже в demo, і
    // подовжувати їм демо не можна — інакше безкоштовне стає вічним.
    const again = await planEndBeta(repo, new Date('2026-11-09T09:00:00.000Z'));
    expect(again).toHaveLength(0);
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
    expect(notes[0]).toContain('До 8 листопада можна спокійно користуватись');
  });
});

// Інцидент 01.10: один @example.com зупинив скрипт посередині — 21 дім
// перейшов, 9 лишились у бета-стані. Тепер одна адреса не вирішує долю інших.
describe('applyEndBeta · одна адреса не валить прохід', () => {
  class PickyMailer {
    readonly delivers = true;
    readonly out: string[] = [];
    constructor(private readonly breaksOn: RegExp) {}
    async sendPlain(m: { to: string }): Promise<void> {
      if (this.breaksOn.test(m.to)) throw new Error('550 Invalid `to` field');
      this.out.push(m.to);
    }
    async sendMagicLink(): Promise<void> { throw new Error('не для цього тесту'); }
  async sendInvite(): Promise<void> { throw new Error('не для цього тесту'); }
  }

  it('дім із мертвою адресою не спиняє решти: усі отримують demo, невдача в підсумку', async () => {
    const repo = new InMemoryRepo();
    const bad = await repo.createUserWithHousehold('qa@gmail.com', 'QA');     // на цій падає
    const good = await repo.createUserWithHousehold('real@gmail.com', 'Р');
    const mailer = new PickyMailer(/^qa@/);
    const r = await applyEndBeta({ repo, mailer: mailer as never, appUrl: 'http://app.test', now: () => NOW });

    expect(r).toMatchObject({ households: 2, mails: 1, failed: 1 });
    expect(r.failures).toEqual([bad.household_id]);
    // Головне: обидва доми в demo, а не лише той, що до падіння.
    for (const h of [bad.household_id, good.household_id]) {
      expect(await repo.getSubscription(h)).toMatchObject({ state: 'demo', demo_ends_at: PLUS7 });
    }
    expect(mailer.out).toEqual(['real@gmail.com']);
  });

  it('@example.com не пробуємо зовсім: стан є, лічильник «пропущено»', async () => {
    const repo = new InMemoryRepo();
    const qa = await repo.createUserWithHousehold('qa@example.com', 'QA');
    const mailer = new PickyMailer(/@example\.com$/);   // кинув би, якби дійшло
    const r = await applyEndBeta({ repo, mailer: mailer as never, appUrl: 'http://app.test', now: () => NOW });
    expect(r).toMatchObject({ households: 1, mails: 0, skipped: 1, failed: 0 });
    expect(r.failures).toEqual([]);
    expect(await repo.getSubscription(qa.household_id)).toMatchObject({ state: 'demo' });
  });
});
