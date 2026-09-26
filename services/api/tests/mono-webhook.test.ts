// Вебхук monobank (план mono, задача 3). Підпис справжній — пара ключів
// народжується в тесті; мережі немає, відкритий ключ підсовуємо через опцію.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, createSign, randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { FakeBillingProvider } from '../src/billing/fake-provider.js';

const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PEM = keys.publicKey.export({ type: 'spki', format: 'pem' }) as string;

describe('POST /v1/billing/mono', () => {
  let repo: InMemoryRepo;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    process.env.MONO_TOKEN = 'test-token';
    repo = new InMemoryRepo();
    app = buildApp(repo, new InMemoryStore(), new ConsoleMailer(), {
      billing: new FakeBillingProvider(),
      monoPubKey: async () => PEM,
    });
    await app.ready();
  });
  afterEach(() => { delete process.env.MONO_TOKEN; });

  // Тіло надсилаємо рядком і підписуємо ТІ САМІ байти: якби маршрут
  // підписував розібраний і зібраний назад JSON, підпис не зійшовся б.
  const hook = (body: object, sig?: string) => {
    const raw = JSON.stringify(body);
    return app.inject({
      method: 'POST', url: '/v1/billing/mono',
      headers: { 'content-type': 'application/json', 'x-sign': sig ?? createSign('SHA256').update(Buffer.from(raw)).sign(keys.privateKey).toString('base64') },
      payload: raw,
    });
  };

  const intent = async (order_id: string) => repo.insertIntent({
    order_id, plan: 'home', state: 'pending', trial_ends_at: '2026-10-19T00:00:00.000Z',
    card_mask: null, card_token: null, household_id: null, ip: null,
    created_at: '2026-10-01T00:00:00.000Z', expires_at: '2026-10-08T00:00:00.000Z', bound_at: null,
  });

  it('без MONO_TOKEN — 503, тіло навіть не розбираємо', async () => {
    delete process.env.MONO_TOKEN;
    expect((await hook({ invoiceId: 'i', status: 'success', amount: 0, reference: 'x' })).statusCode).toBe(503);
  });

  it('підпис не зійшовся — 403', async () => {
    const r = await hook({ invoiceId: 'i', status: 'success', amount: 21000, reference: 'x' }, 'MEUCIQC/пiдробка');
    expect(r.statusCode).toBe(403);
  });

  it('заголовка X-Sign немає зовсім — 403', async () => {
    const r = await app.inject({
      method: 'POST', url: '/v1/billing/mono',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ invoiceId: 'i', status: 'success', amount: 0, reference: 'x' }),
    });
    expect(r.statusCode).toBe(403);
  });

  it('тіло підмінили після підпису — 403', async () => {
    const honest = JSON.stringify({ invoiceId: 'i', status: 'success', amount: 100, reference: 'x' });
    const sig = createSign('SHA256').update(Buffer.from(honest)).sign(keys.privateKey).toString('base64');
    const r = await app.inject({
      method: 'POST', url: '/v1/billing/mono',
      headers: { 'content-type': 'application/json', 'x-sign': sig },
      payload: JSON.stringify({ invoiceId: 'i', status: 'success', amount: 9999999, reference: 'x' }),
    });
    expect(r.statusCode).toBe(403);
  });

  it('проміжний статус — 200 ignored, нічого не міняємо', async () => {
    const order_id = randomUUID();
    await intent(order_id);
    const r = await hook({ invoiceId: 'i', status: 'processing', amount: 21000, reference: order_id });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ignored: true });
    expect(await repo.getIntent(order_id)).toMatchObject({ state: 'pending' });
  });

  it('верифікація картки → намір subscribed із токеном і маскою', async () => {
    const order_id = randomUUID();
    await intent(order_id);
    const r = await hook({
      invoiceId: 'inv-1', status: 'success', amount: 0, reference: order_id,
      walletData: { walletId: order_id, cardToken: 'tok-c', status: 'created' },
      paymentInfo: { maskedPan: '444403******1902' },
    });
    expect(r.statusCode).toBe(200);
    expect(await repo.getIntent(order_id)).toMatchObject({ state: 'subscribed', card_token: 'tok-c', card_mask: '1902' });
  });

  it('списання дому → active і рядок платежу', async () => {
    const { user_id, household_id } = await repo.createUserWithHousehold('mono@x.test', 'M');
    await repo.saveSubscription({
      household_id, state: 'trial', plan: 'home', trial_used_at: '2026-10-01T00:00:00.000Z',
      trial_ends_at: '2026-10-15T00:00:00.000Z', next_charge_at: '2026-10-15T00:00:00.000Z',
      access_until: null, provider_order_id: 'ord-m', card_mask: '1902', card_token: 'tok-c',
      paid_by_user_id: user_id, deletion_warned_at: null, trial_mail_sent_at: null,
      updated_at: '2026-10-01T00:00:00.000Z',
    });
    const r = await hook({ invoiceId: 'inv-9', status: 'success', amount: 29000, reference: 'ord-m' });
    expect(r.statusCode).toBe(200);
    expect(await repo.getSubscription(household_id)).toMatchObject({ state: 'active' });
    expect(await repo.listPayments(household_id)).toHaveLength(1);
  });

  it('невідомий order — 200, а не 404: інакше mono битиме повторами', async () => {
    const r = await hook({ invoiceId: 'i', status: 'success', amount: 21000, reference: 'нікому-не-належить' });
    expect(r.statusCode).toBe(200);
  });

  it('глобальний JSON-парсер не зламано — інші маршрути читають тіло як раніше', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/billing/intent', payload: { plan: 'home' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveProperty('order_id');
  });
});
