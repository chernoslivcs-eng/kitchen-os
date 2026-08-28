import { describe, it, expect } from 'vitest';
import { CATALOG, BY_KEY } from '../seed.js';
import { itemMatchesAntipattern, resolveLabelToKey } from '../logic.js';

// Критерій 2:
// «антипатерн "не їм свинину" позначає "Ковбаса Міланська"»

describe('antipattern · не їм свинину', () => {
  it('Ковбаса Міланська підпадає під «не їм свинину»', () => {
    const salami = BY_KEY.get('salami_milano_pork')!;
    expect(itemMatchesAntipattern(salami, 'не їм свинину')).toBe(true);
  });

  it('через резолвер: пантрі-лейбл «Ковбаса Міланська» → salami_milano_pork', () => {
    expect(resolveLabelToKey('Ковбаса Міланська')).toBe('salami_milano_pork');
  });

  it('«не їм свинину» також ловить свинячий фарш через категорію', () => {
    const ground = BY_KEY.get('ground_beef_pork')!;
    expect(itemMatchesAntipattern(ground, 'не їм свинину й похідні')).toBe(true);
  });

  it('«не їм свинину» НЕ ловить курку й лосося', () => {
    expect(itemMatchesAntipattern(BY_KEY.get('chicken_whole')!, 'не їм свинину')).toBe(false);
    expect(itemMatchesAntipattern(BY_KEY.get('salmon_fresh')!, 'не їм свинину')).toBe(false);
  });

  it('«не люблю кінзу» позначає кінзу свіжу', () => {
    expect(itemMatchesAntipattern(BY_KEY.get('cilantro_fresh')!, 'не люблю кінзу')).toBe(true);
  });

  it('порожня фраза не позначає нічого', () => {
    expect(CATALOG.filter((i) => itemMatchesAntipattern(i, '')).length).toBe(0);
  });
});
