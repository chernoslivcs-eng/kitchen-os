import { describe, it, expect } from 'vitest';
import { INTENT_TTL_DAYS, TRIAL_DAYS, applyProviderEvent, entitlementOf, tick, trialEndsFrom, type HouseholdSubscription } from './subscription.js';

const base = (p: Partial<HouseholdSubscription>): HouseholdSubscription => ({
  household_id: 'h1', state: 'active', plan: 'self', trial_used_at: null, trial_ends_at: null,
  next_charge_at: null, access_until: null, provider_order_id: null, card_mask: null,
  paid_by_user_id: null, deletion_warned_at: null, trial_mail_sent_at: null, updated_at: '2026-09-25T00:00:00Z', ...p,
});
const now = new Date('2026-10-01T12:00:00Z');

describe('entitlementOf', () => {
  it('без рядка: full у бету, read_only без бети', () => {
    expect(entitlementOf(null, now, { beta: true })).toBe('full');
    expect(entitlementOf(null, now, { beta: false })).toBe('read_only');
  });
  it.each([
    ['beta', {}, 'full'],
    ['active', {}, 'full'],
    ['past_due', {}, 'full'],
    ['lapsed', {}, 'read_only'],
    ['trial', { trial_ends_at: '2026-10-15T00:00:00Z' }, 'full'],
    ['trial', { trial_ends_at: '2026-09-30T00:00:00Z' }, 'read_only'],
    ['cancelled', { access_until: '2026-10-15T00:00:00Z' }, 'full'],
    ['cancelled', { access_until: '2026-09-30T00:00:00Z' }, 'read_only'],
  ] as const)('%s %o → %s', (state, extra, want) => {
    expect(entitlementOf(base({ state, ...extra }), now, { beta: false })).toBe(want);
  });
});

describe('applyProviderEvent', () => {
  // Дата приходить У ПОДІЇ, домен її не рахує (спек біллінгу §9.1): між
  // оформленням і привʼязкою може минути до 7 днів, і `now + 14` розійшлося б
  // із тим, що вже стоїть у LiqPay як subscribe_date_start.
  it('subscribed з датою пробного → trial із ТІЄЮ САМОЮ датою', () => {
    const r = applyProviderEvent(null, { kind: 'subscribed', household_id: 'h1', order_id: 'o1', plan: 'home', card_mask: '4242', trial_ends_at: '2026-10-20T00:00:00.000Z', paid_by_user_id: 'u1' }, now);
    expect(r.sub.state).toBe('trial');
    expect(r.sub.trial_ends_at).toBe('2026-10-20T00:00:00.000Z');
    expect(r.sub.next_charge_at).toBe('2026-10-20T00:00:00.000Z');
    expect(r.sub.trial_used_at).toBe(now.toISOString());
  });
  it('subscribed без пробного (повернення) → active, наступне списання через місяць', () => {
    const prev = base({ state: 'lapsed', trial_used_at: '2026-01-01T00:00:00Z' });
    const r = applyProviderEvent(prev, { kind: 'subscribed', household_id: 'h1', order_id: 'o2', plan: 'self', card_mask: '1111', trial_ends_at: null, paid_by_user_id: 'u2' }, now);
    expect(r.sub.state).toBe('active');
    expect(r.sub.next_charge_at).toBe('2026-11-01T12:00:00.000Z');
  });
  // Намір із лендінга несе дату пробного навіть тоді, коли дім свій пробний уже
  // витратив: списання все одно буде в цю дату, бо вона стоїть у LiqPay. Але
  // ДРУГИМ пробним це не стає — `trial_used_at` лишається першим.
  it('дата пробного на домі, що вже мав пробний → trial_used_at не переписується', () => {
    const prev = base({ state: 'lapsed', trial_used_at: '2026-01-01T00:00:00.000Z' });
    const r = applyProviderEvent(prev, { kind: 'subscribed', household_id: 'h1', order_id: 'o3', plan: 'self', card_mask: '1', trial_ends_at: '2026-10-20T00:00:00.000Z', paid_by_user_id: 'u3' }, now);
    expect(r.sub.trial_ends_at).toBe('2026-10-20T00:00:00.000Z');
    expect(r.sub.trial_used_at).toBe('2026-01-01T00:00:00.000Z');
  });
  it('інваріант: намір живе коротше за пробний', () => {
    expect(INTENT_TTL_DAYS).toBeLessThan(TRIAL_DAYS);
  });
  it('trialEndsFrom рахує ту саму дату, що піде в LiqPay', () => {
    expect(trialEndsFrom(now)).toBe('2026-10-15T12:00:00.000Z');
  });
  it('success у trial → active, платіж записаний, next_charge +1 міс', () => {
    const prev = base({ state: 'trial', trial_ends_at: '2026-10-01T00:00:00Z', next_charge_at: '2026-10-01T00:00:00Z', provider_order_id: 'o1' });
    const r = applyProviderEvent(prev, { kind: 'success', order_id: 'o1', amount: 210, provider_payment_id: 'p1' }, now);
    expect(r.sub.state).toBe('active');
    expect(r.payment).toMatchObject({ household_id: 'h1', amount: 210, status: 'success' });
    expect(r.sub.next_charge_at).toBe('2026-11-01T00:00:00.000Z');
  });
  it('failure → past_due; unsubscribed → cancelled з access_until = next_charge_at', () => {
    const prev = base({ next_charge_at: '2026-10-20T00:00:00Z', provider_order_id: 'o1' });
    expect(applyProviderEvent(prev, { kind: 'failure', order_id: 'o1' }, now).sub.state).toBe('past_due');
    const c = applyProviderEvent(prev, { kind: 'unsubscribed', order_id: 'o1' }, now).sub;
    expect(c.state).toBe('cancelled');
    expect(c.access_until).toBe('2026-10-20T00:00:00Z');
  });
  // Поле з плану, якого нема в його ж прикладах: повернення після паузи не
  // має тягти за собою старий слід «лист про кінець пробного надіслано».
  it('нове оформлення скидає trial_mail_sent_at', () => {
    const prev = base({ state: 'lapsed', trial_used_at: '2026-01-01T00:00:00Z', trial_mail_sent_at: '2026-01-10T00:00:00Z' });
    expect(applyProviderEvent(prev, { kind: 'subscribed', household_id: 'h1', order_id: 'o4', plan: 'self', card_mask: '1111', trial_ends_at: null, paid_by_user_id: 'u2' }, now).sub.trial_mail_sent_at).toBeNull();
  });
});

describe('tick (щоденний крон)', () => {
  it('cancelled після access_until → lapsed', () => {
    expect(tick(base({ state: 'cancelled', access_until: '2026-09-30T00:00:00Z' }), now)?.state).toBe('lapsed');
  });
  it('past_due довше за 7 днів після next_charge_at → lapsed', () => {
    expect(tick(base({ state: 'past_due', next_charge_at: '2026-09-20T00:00:00Z' }), now)?.state).toBe('lapsed');
    expect(tick(base({ state: 'past_due', next_charge_at: '2026-09-28T00:00:00Z' }), now)).toBeNull();
  });
  it('trial після trial_ends_at + 1 день без success → past_due', () => {
    expect(tick(base({ state: 'trial', trial_ends_at: '2026-09-29T00:00:00Z', next_charge_at: '2026-09-29T00:00:00Z' }), now)?.state).toBe('past_due');
  });
  it('active з next_charge_at у майбутньому — без змін', () => {
    expect(tick(base({ next_charge_at: '2026-11-01T00:00:00Z' }), now)).toBeNull();
  });
  // Спек §7: гонка вебхука з кроном. Оплата прийшла, next_charge_at поїхав у
  // майбутнє — крон не має права забрати доступ назад.
  it('past_due з next_charge_at у майбутньому — крон мовчить', () => {
    expect(tick(base({ state: 'past_due', next_charge_at: '2026-11-01T00:00:00Z' }), now)).toBeNull();
  });
});
