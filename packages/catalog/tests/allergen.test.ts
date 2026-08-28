import { describe, it, expect } from 'vitest';
import { CATALOG, BY_KEY } from '../seed.js';
import { itemMatchesAllergen, resolveLabelToKey } from '../logic.js';

// Критерій 1 з 04-roadmap.html / завдання:
// «алергія "молюски" позначає "Karolina — мʼясо мідій"»

describe('allergen · молюски', () => {
  it('позиція мʼясо мідій позначена як «молюски»', () => {
    const mussel = BY_KEY.get('mussel_meat')!;
    expect(itemMatchesAllergen(mussel, 'молюски')).toBe(true);
  });

  it('«Karolina — мʼясо мідій» резолвиться в mussel_meat', () => {
    expect(resolveLabelToKey('Karolina — мʼясо мідій')).toBe('mussel_meat');
    expect(resolveLabelToKey("Karolina – м'ясо мідій")).toBe('mussel_meat');
  });

  it('через резолвер + католог алергія доходить до пантрі-лейбла', () => {
    const label = 'Karolina — мʼясо мідій';
    const key = resolveLabelToKey(label);
    expect(key).toBe('mussel_meat');
    const item = BY_KEY.get(key!)!;
    expect(itemMatchesAllergen(item, 'молюски')).toBe(true);
  });

  it('«молочне» позначає моцарелу, камбоцолу і пармезан', () => {
    const flagged = CATALOG.filter((i) => itemMatchesAllergen(i, 'молочне')).map((i) => i.key);
    expect(flagged).toEqual(expect.arrayContaining(['mozzarella_pizza', 'cambozola_cheese', 'parmesan', 'milk_cow_25']));
  });

  it('«риба» позначає лосося, але не позначає мідій (молюски — не риба)', () => {
    expect(itemMatchesAllergen(BY_KEY.get('salmon_fresh')!, 'риба')).toBe(true);
    expect(itemMatchesAllergen(BY_KEY.get('mussel_meat')!, 'риба')).toBe(false);
  });
});
