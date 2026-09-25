// ingestProviderEvent — «подія → дім або намір» (спек §9.2). Довіра вже
// встановлена вище; тут перевіряється лише маршрутизація й запис.
import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryRepo } from '@kitchen/domain';
import { ingestProviderEvent } from '../src/billing/ingest.js';

const NOW = new Date('2026-10-05T10:00:00.000Z');
const log = { warn: vi.fn() };

const sub = (household_id: string, order_id: string, over: Record<string, unknown> = {}) => ({
  household_id, state: 'trial', plan: 'self', trial_used_at: '2026-10-01T00:00:00.000Z',
  trial_ends_at: '2026-10-15T00:00:00.000Z', next_charge_at: '2026-10-15T00:00:00.000Z',
  access_until: null, provider_order_id: order_id, card_mask: '4242', paid_by_user_id: null,
  deletion_warned_at: null, trial_mail_sent_at: null, updated_at: NOW.toISOString(), ...over,
}) as never;

const intent = (order_id: string, over: Record<string, unknown> = {}) => ({
  order_id, plan: 'home' as const, state: 'pending' as const, trial_ends_at: '2026-10-19T00:00:00.000Z',
  card_mask: null, household_id: null, ip: null, created_at: '2026-10-05T00:00:00.000Z',
  expires_at: '2026-10-12T00:00:00.000Z', bound_at: null, ...over,
});

describe('ingestProviderEvent', () => {
  it('дім + success → active і записаний платіж', async () => {
    const repo = new InMemoryRepo();
    const { household_id } = await repo.createUserWithHousehold('h@x.test', 'H');
    await repo.saveSubscription(sub(household_id, 'ord-1'));
    const r = await ingestProviderEvent(repo, { kind: 'success', order_id: 'ord-1', amount: 210, provider_payment_id: 'p1' }, NOW, log);
    expect(r).toEqual({ target: 'household', state: 'active' });
    expect(await repo.listPayments(household_id)).toHaveLength(1);
  });

  // Вебхук не знає дати пробного — вона вже лежить у підписці з checkout.
  it('дім + subscribed без дати в події → дата береться з підписки', async () => {
    const repo = new InMemoryRepo();
    const { household_id } = await repo.createUserWithHousehold('h2@x.test', 'H');
    await repo.saveSubscription(sub(household_id, 'ord-2', { state: 'lapsed' }));
    const r = await ingestProviderEvent(repo, { kind: 'subscribed', order_id: 'ord-2', card_mask: '1111' }, NOW, log);
    expect(r).toEqual({ target: 'household', state: 'trial' });
    const after = await repo.getSubscription(household_id);
    expect(after?.trial_ends_at).toBe('2026-10-15T00:00:00.000Z');
    expect(after?.card_mask).toBe('1111');
  });

  it('намір + subscribed → намір позначено, маска збережена', async () => {
    const repo = new InMemoryRepo();
    const order_id = randomUUID();
    await repo.insertIntent(intent(order_id));
    const r = await ingestProviderEvent(repo, { kind: 'subscribed', order_id, card_mask: '9999' }, NOW, log);
    expect(r).toEqual({ target: 'intent', state: 'subscribed' });
    expect(await repo.getIntent(order_id)).toMatchObject({ state: 'subscribed', card_mask: '9999' });
  });

  it('намір + unsubscribed → expired', async () => {
    const repo = new InMemoryRepo();
    const order_id = randomUUID();
    await repo.insertIntent(intent(order_id, { state: 'subscribed' }));
    expect(await ingestProviderEvent(repo, { kind: 'unsubscribed', order_id }, NOW, log)).toEqual({ target: 'intent', state: 'expired' });
  });

  it('намір + success — «не може бути»: нічого не пишемо, лишаємо слід у лозі', async () => {
    const repo = new InMemoryRepo();
    const order_id = randomUUID();
    await repo.insertIntent(intent(order_id, { state: 'subscribed' }));
    log.warn.mockClear();
    const r = await ingestProviderEvent(repo, { kind: 'success', order_id, amount: 210, provider_payment_id: 'p9' }, NOW, log);
    expect(r).toEqual({ target: 'none', reason: 'no_household_for_money' });
    expect(log.warn).toHaveBeenCalledOnce();
    expect(await repo.getIntent(order_id)).toMatchObject({ state: 'subscribed' });
  });

  it('невідомий order — нічого', async () => {
    const repo = new InMemoryRepo();
    expect(await ingestProviderEvent(repo, { kind: 'failure', order_id: 'нема' }, NOW, log)).toEqual({ target: 'none', reason: 'unknown_order' });
  });
});
