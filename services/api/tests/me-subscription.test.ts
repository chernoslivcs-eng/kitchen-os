// /v1/me віддає стан підписки й готовий банер (спек 2026-09-25 §3): веб нічого
// не рахує сам — ні entitlement, ні текст банера, щоб клієнт і сервер не
// розійшлись у тому, що людина зараз може.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

describe('GET /v1/me · підписка', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  // Контракт для веба (спек 2026-10-01 §5): новий дім — одразу demo, з датою
  // кінця і готовим банером. ЛЕНДІНГ малює по цих полях і сам нічого не рахує.
  it('новий дім → demo з demo_ends_at, full і банером «Оформити»', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const body = (await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: A.cookie } })).json();
    expect(body.subscription).toMatchObject({
      state: 'demo', entitlement: 'full', plan: null,
      // Пробний витрачено демо — текст перед банком мусить обіцяти «протягом
      // доби», а не конкретну дату.
      trial_available: false,
      banner: { cta: 'Оформити', to: '/profile/subscription' },
    });
    expect(body.subscription.demo_ends_at).toMatch(/^2\d{3}-/);
    expect(body.subscription.banner.text).toMatch(/^Демо до /);
  });

  it('дім без рядка (старий, до end-beta) → beta/full, банера нема', async () => {
    const A = await signIn(app, mailer, 'old@example.com');
    const household_id = await repo.firstHouseholdOf(A.user_id);
    // Такий рядок у проді лишився від бети: демо йому поставить скрипт того ж
    // дня. До того дім мусить працювати, а не замкнутись.
    // Інтерфейс Repo прибирати підписку не вміє й не мусить — такого випадку в
    // продукті немає, він лишився з бети. Тому лізу в памʼять репозиторію.
    (repo as unknown as { householdSubs: Map<string, unknown> }).householdSubs.delete(household_id!);
    const body = (await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: A.cookie } })).json();
    expect(body.subscription).toMatchObject({ state: 'beta', entitlement: 'full', banner: null, demo_ends_at: null });
  });

  it('демо скінчилось → read_only, банер лишається демовим до крону', async () => {
    const A = await signIn(app, mailer, 'past@example.com');
    const household_id = (await repo.firstHouseholdOf(A.user_id))!;
    const sub = (await repo.getSubscription(household_id))!;
    await repo.saveSubscription({ ...sub, demo_ends_at: '2026-01-01T00:00:00.000Z' });
    const body = (await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: A.cookie } })).json();
    // Право рахується з дати, а не зі стану: крон переведе в lapsed о 03:30, і
    // до того моменту дім уже не мусить писати.
    expect(body.subscription).toMatchObject({ state: 'demo', entitlement: 'read_only' });
  });

  it('lapsed → read_only і банер із дверима', async () => {
    const A = await signIn(app, mailer, 'b@example.com');
    const household_id = await repo.firstHouseholdOf(A.user_id);
    await repo.saveSubscription({
      household_id: household_id!, state: 'lapsed', plan: 'self', trial_used_at: null, trial_ends_at: null,
      next_charge_at: null, access_until: null, provider_order_id: null, card_mask: null, card_token: null, paid_by_user_id: null,
      deletion_warned_at: null, trial_mail_sent_at: null, demo_ends_at: null, demo_mail_sent_at: null, updated_at: new Date().toISOString(),
    });
    const body = (await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: A.cookie } })).json();
    expect(body.subscription).toMatchObject({
      state: 'lapsed', entitlement: 'read_only',
      banner: { text: 'Підписка закінчилась — усе лишив як було.', to: '/profile/subscription' },
    });
  });
});
