import { describe, it, expect } from 'vitest';
import { subscriptionRowSummary } from './summary';
import type { Me } from '../../api';

function sub(over: Partial<NonNullable<Me['subscription']>>): NonNullable<Me['subscription']> {
  return { state: 'active', demo_ends_at: null, plan: 'home', entitlement: 'full', trial_ends_at: null, next_charge_at: null, access_until: null, card_mask: null, banner: null, ...over };
}

// Рішення власника 01.10 (demo-instead-of-beta §6): пункт «Підписка» в
// профілі не мав гілки на demo — падав у default:'' (порожній рядок),
// доки не додали окремий case.
describe('subscriptionRowSummary · demo (01.10)', () => {
  it('demo з датою — «Демо до DD.MM»', () => {
    expect(subscriptionRowSummary(sub({ state: 'demo', plan: null, demo_ends_at: '2026-10-08T00:00:00Z' }))).toBe('Демо до 08.10');
  });

  it('demo без дати — просто «Демо», не порожній рядок', () => {
    expect(subscriptionRowSummary(sub({ state: 'demo', plan: null, demo_ends_at: null }))).toBe('Демо');
  });

  it('beta (транзитний технічний стан) — без змін', () => {
    expect(subscriptionRowSummary(sub({ state: 'beta', plan: null }))).toBe('Бета-тест');
  });
});
