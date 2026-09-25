import { describe, it, expect } from 'vitest';
import { PAYWALL, MAIL, bannerFor, paywallBody } from './paywall.js';

const BANNED = /безпечн|гарантує|придатн|не містить|на жаль|шкода|прикро/i;
const all = JSON.stringify({ PAYWALL, MAIL });

describe('paywall copy', () => {
  it('без заборонених слів', () => { expect(all).not.toMatch(BANNED); });
  // Рішення власника «A» (LiqPay-підписка): при оформленні не списується
  // нічого, картка лише перевіряється. Обіцянка «за 1 ₴» жила в плані до
  // цього рішення й одного разу вже протекла в лист — хай тепер падає тест.
  it('жоден текст не обіцяє списання 1 ₴', () => {
    expect(JSON.stringify({ PAYWALL, MAIL: { ...MAIL, endBeta: MAIL.endBeta('1 січня'), trialEnds: MAIL.trialEnds('1 січня', '4242', 210, 'l'), deletionWarning: MAIL.deletionWarning('l') } })).not.toMatch(/1\s*₴/);
  });
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
