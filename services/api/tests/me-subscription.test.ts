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

  it('без рядка в бету → beta/full, банера нема', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const body = (await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: A.cookie } })).json();
    expect(body.subscription).toMatchObject({ state: 'beta', entitlement: 'full', banner: null });
  });

  it('lapsed → read_only і банер із дверима', async () => {
    const A = await signIn(app, mailer, 'b@example.com');
    const household_id = await repo.firstHouseholdOf(A.user_id);
    await repo.saveSubscription({
      household_id: household_id!, state: 'lapsed', plan: 'self', trial_used_at: null, trial_ends_at: null,
      next_charge_at: null, access_until: null, provider_order_id: null, card_mask: null, paid_by_user_id: null,
      deletion_warned_at: null, trial_mail_sent_at: null, updated_at: new Date().toISOString(),
    });
    const body = (await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: A.cookie } })).json();
    expect(body.subscription).toMatchObject({
      state: 'lapsed', entitlement: 'read_only',
      banner: { text: 'Підписка закінчилась — усе лишив як було.', to: '/profile/subscription' },
    });
  });
});
