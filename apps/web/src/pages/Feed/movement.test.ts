// Спек власника 30.09 (docs/superpowers/specs/2026-09-30-pantry-movement-cards-design.md).
// §2 — таблиця рядків, кожен випадок тестом. §3 — три назви сліду/шапки за
// агрегатним знаком картки.
import { describe, it, expect } from 'vitest';
import { movementText, cardSign, movementLabel, movementSubtitle } from './movement';

describe('movementText · §2 таблиця рядків', () => {
  it('add з кількістю — «+1 л»', () => {
    expect(movementText({ op: 'add', value: 1, unit: 'l' })).toEqual({ sign: '+', text: '+1 л' });
  });

  it('add без кількості — голий «+»', () => {
    expect(movementText({ op: 'add' })).toEqual({ sign: '+', text: '+' });
  });

  it('deplete, є before.value — «−500 г» (списане = before)', () => {
    expect(movementText({ op: 'deplete', before: { value: 500, unit: 'g' } }))
      .toEqual({ sign: '−', text: '−500 г' });
  });

  it('deplete, before.value null — голий «−»', () => {
    expect(movementText({ op: 'deplete', before: { value: null, unit: null } })).toEqual({ sign: '−', text: '−' });
  });

  it('deplete, before взагалі нема (стара картка) — голий «−»', () => {
    expect(movementText({ op: 'deplete' })).toEqual({ sign: '−', text: '−' });
  });

  it('correct, ті самі одиниці, value < before — «−100 г» (before − value)', () => {
    expect(movementText({ op: 'correct', value: 200, unit: 'g', before: { value: 300, unit: 'g' } }))
      .toEqual({ sign: '−', text: '−100 г' });
  });

  it('correct, ті самі одиниці, value > before — «+200 г»', () => {
    expect(movementText({ op: 'correct', value: 300, unit: 'g', before: { value: 100, unit: 'g' } }))
      .toEqual({ sign: '+', text: '+200 г' });
  });

  it('correct, value === before — без знака, число як є (нічого фактично не змінилось)', () => {
    expect(movementText({ op: 'correct', value: 200, unit: 'g', before: { value: 200, unit: 'g' } }))
      .toEqual({ sign: null, text: '200 г' });
  });

  it('correct без before — «300 г» без знака', () => {
    expect(movementText({ op: 'correct', value: 300, unit: 'g' })).toEqual({ sign: null, text: '300 г' });
  });

  it('correct, одиниці не зводяться (before у інших одиницях) — без знака, значення op', () => {
    expect(movementText({ op: 'correct', value: 2, unit: 'pcs', before: { value: 800, unit: 'g' } }))
      .toEqual({ sign: null, text: '2 шт' });
  });

  it('open — слово «відкрито», без знака й числа', () => {
    expect(movementText({ op: 'open' })).toEqual({ sign: null, text: 'відкрито' });
  });

  it('rename — без знака й числа (перехід — у назві рядка, не тут)', () => {
    expect(movementText({ op: 'rename' })).toEqual({ sign: null, text: '' });
  });

  it('add упаковано (qty/pack) — «+N шт · вага»', () => {
    expect(movementText({ op: 'add', qty: 4, pack: { v: 400, u: 'g' } }))
      .toEqual({ sign: '+', text: '+4 шт · 400 г' });
  });
});

describe('cardSign · §3 агрегатний знак', () => {
  it('усі add — «+»', () => {
    expect(cardSign([{ op: 'add', value: 1, unit: 'l' }, { op: 'add' }])).toBe('+');
  });

  it('усі deplete — «−»', () => {
    expect(cardSign([{ op: 'deplete' }, { op: 'deplete', before: { value: 4, unit: 'pcs' } }])).toBe('−');
  });

  it('мішане (add + deplete) — null («Комора»)', () => {
    expect(cardSign([{ op: 'add', value: 1, unit: 'pcs' }, { op: 'deplete' }])).toBe(null);
  });

  it('лише зміни стану (open/rename) — null', () => {
    expect(cardSign([{ op: 'open' }, { op: 'rename' }])).toBe(null);
  });

  it('correct із value>before (по суті «+») серед самих correct того ж напрямку — «+»', () => {
    expect(cardSign([{ op: 'correct', value: 300, unit: 'g', before: { value: 100, unit: 'g' } }])).toBe('+');
  });

  it('порожні ops — null, не «+» (vacuous truth пастка .every на [])', () => {
    expect(cardSign([])).toBe(null);
  });
});

describe('movementLabel · §3 три назви', () => {
  it('«+» → «У комору»', () => { expect(movementLabel('+')).toBe('У комору'); });
  it('«−» → «Списано»', () => { expect(movementLabel('−')).toBe('Списано'); });
  it('null → «Комора»', () => { expect(movementLabel(null)).toBe('Комора'); });
});

describe('movementSubtitle · підрядок сліду', () => {
  it('«+» → «N у комору»', () => { expect(movementSubtitle(3, '+')).toBe('3 у комору'); });
  it('«−» → «N з комори»', () => { expect(movementSubtitle(2, '−')).toBe('2 з комори'); });
  it('null → «N змін» (українська множина)', () => {
    expect(movementSubtitle(1, null)).toBe('1 зміна');
    expect(movementSubtitle(2, null)).toBe('2 зміни');
    expect(movementSubtitle(5, null)).toBe('5 змін');
  });
});
