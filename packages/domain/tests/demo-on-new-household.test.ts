// Демо з першої хвилини (спек 2026-10-01-demo-instead-of-beta §3): КОЖЕН новий
// дім отримує рядок підписки в момент створення, на всіх шляхах входу.
//
// Чому це тест, а не «очевидно»: право доступу рахується з рядка, і дім без
// рядка читається як старий (повний доступ назавжди, див. entitlementOf).
// Тобто забутий шлях входу — це не збій, а тихо безкоштовний дім.
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRepo } from '../in-memory-repo.js';
import { signInWithVerifiedEmail, signInWithTelegram } from '../auth.js';
import { DEMO_DAYS, entitlementOf } from '../subscription.js';

const DAY = 86_400_000;

describe('новий дім → demo', () => {
  let repo: InMemoryRepo;
  beforeEach(() => { repo = new InMemoryRepo(); });

  it('перший вхід поштою (той самий шлях, що Google): demo на 7 днів', async () => {
    const r = await signInWithVerifiedEmail(repo, 'new@mail.ua', 'Нова');
    const sub = await repo.getSubscription(r.household_id);
    expect(sub).toMatchObject({ state: 'demo', plan: null });
    const ends = new Date(sub!.demo_ends_at!).getTime() - new Date(sub!.updated_at).getTime();
    expect(ends).toBe(DEMO_DAYS * DAY);
    // Демо = використаний пробний: другого безкоштовного періоду не буде.
    expect(sub!.trial_used_at).toBe(sub!.updated_at);
    expect(entitlementOf(sub, new Date())).toBe('full');
  });

  it('перший /start у боті: той самий demo', async () => {
    const r = await signInWithTelegram(repo, { telegram_user_id: 777, chat_id: 777, first_name: 'Бот' });
    expect(r.created).toBe(true);
    expect(await repo.getSubscription(r.household_id)).toMatchObject({ state: 'demo' });
  });

  it('повторний вхід демо не перезапускає й стану не чіпає', async () => {
    const first = await signInWithVerifiedEmail(repo, 'again@mail.ua', 'Знов');
    const before = await repo.getSubscription(first.household_id);
    // Дім уже дожив до читання — другий вхід не мусить дарувати нові 7 днів.
    await repo.saveSubscription({ ...before!, state: 'lapsed' });
    await signInWithVerifiedEmail(repo, 'again@mail.ua', 'Знов');
    expect(await repo.getSubscription(first.household_id)).toMatchObject({ state: 'lapsed' });
  });

  it('гість, якого запросили в чужий дім, свого демо не отримує', async () => {
    const owner = await signInWithVerifiedEmail(repo, 'owner@mail.ua', 'Хазяїн');
    const guest_id = await repo.createUserOnly('guest@mail.ua', 'Гість');
    await repo.addMember(owner.household_id, guest_id, 'member');
    const r = await signInWithVerifiedEmail(repo, 'guest@mail.ua', 'Гість');
    expect(r.household_id).toBe(owner.household_id);
    // Рядок один — дому, не людині.
    expect(await repo.getSubscription(owner.household_id)).toMatchObject({ state: 'demo' });
  });
});
