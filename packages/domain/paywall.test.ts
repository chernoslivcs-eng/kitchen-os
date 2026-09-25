import { describe, it, expect } from 'vitest';
import { PAYWALL, MAIL, bannerFor, paywallBody } from './paywall.js';

const BANNED = /безпечн|гарантує|придатн|не містить|на жаль|шкода|прикро/i;
const all = JSON.stringify({ PAYWALL, MAIL });

describe('paywall copy', () => {
  it('без заборонених слів', () => { expect(all).not.toMatch(BANNED); });
  it('тіло 402 має kind, текст і двері', () => {
    expect(paywallBody('lapsed')).toEqual({ kind: 'paywall', state: 'lapsed', text: PAYWALL.chat.text, cta: { label: 'Продовжити', to: '/profile/subscription' } });
  });
  it('банер по станах', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    expect(bannerFor({ state: 'lapsed' } as never, now)?.text).toBe('Підписка закінчилась — усе лишив як було.');
    expect(bannerFor({ state: 'trial', trial_ends_at: '2026-10-03T00:00:00Z', plan: 'self' } as never, now)?.text).toContain('далі 210 ₴/міс');
    expect(bannerFor({ state: 'trial', trial_ends_at: '2026-10-20T00:00:00Z', plan: 'self' } as never, now)).toBeNull();
    expect(bannerFor({ state: 'active' } as never, now)).toBeNull();
  });
});
