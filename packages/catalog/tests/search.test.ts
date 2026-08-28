import { describe, it, expect } from 'vitest';
import { search, root, normalize } from '../logic.js';

// Критерій 3:
// «пошук "кінзу" знаходить "кінза свіжа"»

describe('search · морфологічні форми', () => {
  it('«кінзу» знаходить «Кінза свіжа»', () => {
    const hits = search('кінзу');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.item.key).toBe('cilantro_fresh');
  });

  it('«кінза» теж знаходить (точний аліас)', () => {
    const hits = search('кінза');
    expect(hits[0]!.item.key).toBe('cilantro_fresh');
    expect(hits[0]!.layer).toBe('alias');
  });

  it('«spaghetti» знаходить «Спагеті №5» через латинський аліас', () => {
    const hits = search('spaghetti');
    expect(hits[0]!.item.key).toBe('spaghetti_no5');
  });

  it('«часнику» знаходить «Часник» через аліас', () => {
    const hits = search('часнику');
    expect(hits[0]!.item.key).toBe('garlic');
  });

  it('root урізує до min 4 символів', () => {
    expect(root('кінзу')).toBe('кінз');
    expect(root('свинину')).toBe('свини');
    expect(root('арахіс')).toBe('арах');
    expect(root('оил')).toBe('оил'); // короткі не ріжуться
  });

  it('normalize прибирає лапки, апострофи і різні тире', () => {
    expect(normalize("м'ясо мідій")).toBe('мясо мідій');
    expect(normalize('мʼясо мідій')).toBe('мясо мідій');
    expect(normalize('Karolina — м’ясо мідій')).toBe('karolina - мясо мідій');
  });

  it('пошук пустого рядка нічого не повертає', () => {
    expect(search('').length).toBe(0);
  });
});
