// Вибір провайдера оплат (знахідка живого тесту 26.09).
//
// Причина цього файлу: у Preview лежав MONO_TOKEN із порожнім значенням, і
// pickBillingProvider тихо віддавав фейк. У Preview це безневинно, у проді
// означало б, що люди отримують фейкові посилання на оплату, підписки
// оформлюються, а грошей не списує ніхто — і жодного сигналу.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { pickBillingProvider } from '../src/billing/pick-provider.js';
import { FakeBillingProvider } from '../src/billing/fake-provider.js';
import { MonoProvider } from '../src/billing/mono.js';
import { lazyBillingProvider } from '../src/billing/pick-provider.js';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { runBillingCron } from '../src/billing-cron.js';
import { signIn } from './helpers.js';

const APP = 'https://kitchen-os.app';

describe('pickBillingProvider', () => {
  afterEach(() => { delete process.env.MONO_TOKEN; delete process.env.VERCEL_ENV; });

  it('поза продом без токена — фейк: так живуть стенд і тести', () => {
    expect(pickBillingProvider(APP)).toBeInstanceOf(FakeBillingProvider);
  });

  it('у проді без токена — падаємо, і в тексті сказано, що робити', () => {
    process.env.VERCEL_ENV = 'production';
    expect(() => pickBillingProvider(APP)).toThrow(/MONO_TOKEN/);
  });

  it('у проді порожній токен — те саме падіння, не фейк', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.MONO_TOKEN = '   ';
    expect(() => pickBillingProvider(APP)).toThrow(/MONO_TOKEN/);
  });

  it('порожній рядок і пробіли = відсутній і поза продом теж', () => {
    process.env.MONO_TOKEN = '  \n ';
    expect(pickBillingProvider(APP)).toBeInstanceOf(FakeBillingProvider);
  });

  it('Preview із токеном працює як раніше', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.MONO_TOKEN = 'u-test-token';
    expect(pickBillingProvider(APP)).toBeInstanceOf(MonoProvider);
  });

  it('токен обрізається: зайвий перенос рядка з вставляння не поїде в X-Token', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.MONO_TOKEN = ' u-real-token\n';
    const calls: Array<Record<string, string>> = [];
    const p = pickBillingProvider(APP) as MonoProvider;
    // Дістаємо токен єдиним доступним способом — дивимось, що пішло в заголовок.
    (p as unknown as { fetchImpl: unknown }).fetchImpl = async (_u: string, init: { headers: Record<string, string> }) => {
      calls.push(init.headers);
      return { ok: true, status: 200, text: async () => JSON.stringify({ invoiceId: 'i', pageUrl: 'u' }) } as never;
    };
    await p.checkoutUrl({ order_id: 'o', household_id: null, plan: 'self', amount: 210, wallet_id: 'o', result_url: APP });
    expect(calls[0]!['X-Token']).toBe('u-real-token');
  });
});

// Радіус відмови (уточнення 26.09). Без токена в проді падати мусять ЛИШЕ
// оплати. Помилка при складанні застосунку означала б 500 на кожен запит —
// чат, комора, вхід, — тобто зламаний токен оплат гасив би весь продукт.
describe('радіус відмови без MONO_TOKEN у проді', () => {
  let repo: InMemoryRepo; let mailer: ConsoleMailer; let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    process.env.VERCEL_ENV = 'production';
    delete process.env.MONO_TOKEN;
    repo = new InMemoryRepo(); mailer = new ConsoleMailer();
    // Провайдера НЕ передаємо: хочемо справжній лінивий вибір.
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });
  afterEach(() => { delete process.env.VERCEL_ENV; delete process.env.MONO_TOKEN; });

  it('застосунок узагалі складається — помилки на старті немає', () => {
    expect(app).toBeTruthy();
  });

  it('GET /v1/me працює: решта продукту живе', async () => {
    const A = await signIn(app, mailer, 'radius@example.com');
    const r = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: A.cookie } });
    expect(r.statusCode).toBe(200);
  });

  it('POST /v1/subscription/checkout — 500 з нашим текстом', async () => {
    const A = await signIn(app, mailer, 'radius2@example.com');
    // Без цього checkout відповів би 409: у бета-режимі оформлення закрите.
    await repo.saveSubscription({
      household_id: A.household_id, state: 'lapsed', plan: null, trial_used_at: null,
      trial_ends_at: null, next_charge_at: null, access_until: null, provider_order_id: null,
      card_mask: null, card_token: null, paid_by_user_id: null, deletion_warned_at: null,
      trial_mail_sent_at: null, updated_at: '2026-09-01T00:00:00.000Z',
    });
    const r = await app.inject({
      method: 'POST', url: '/v1/subscription/checkout',
      headers: { cookie: A.cookie }, payload: { plan: 'self' },
    });
    expect(r.statusCode).toBe(500);
  });

  it('POST /v1/billing/intent — теж 500, а не фейкове посилання', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/billing/intent', payload: { plan: 'home' } });
    expect(r.statusCode).toBe(500);
  });

  it('крон списання — виняток із нашим текстом', async () => {
    const { household_id } = await repo.createUserWithHousehold('cron-radius@x.test', 'C');
    await repo.saveSubscription({
      household_id, state: 'active', plan: 'home', trial_used_at: null, trial_ends_at: null,
      next_charge_at: '2026-10-01T00:00:00.000Z', access_until: null, provider_order_id: 'ord-c',
      card_mask: '4242', card_token: 'tok-c', paid_by_user_id: null, deletion_warned_at: null,
      trial_mail_sent_at: null, updated_at: '2026-09-01T00:00:00.000Z',
    });
    await expect(runBillingCron({
      repo, mailer, billing: lazyBillingProvider('https://kitchen-os.app'),
      appUrl: 'https://kitchen-os.app', now: () => new Date('2026-10-02T03:30:00.000Z'),
    })).rejects.toThrow(/MONO_TOKEN/);
  });

  it('поза продом усе те саме працює на фейку', async () => {
    delete process.env.VERCEL_ENV;
    const p = lazyBillingProvider('https://kitchen-os.app');
    const r = await p.checkoutUrl({ order_id: 'o', household_id: null, plan: 'self', amount: 210, wallet_id: 'o', result_url: 'x' });
    expect(r.url).toContain('fake');
  });
});

