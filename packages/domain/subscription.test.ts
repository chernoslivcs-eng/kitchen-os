import { describe, it, expect } from 'vitest';
import { entitlementOf, type HouseholdSubscription } from './subscription.js';

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
