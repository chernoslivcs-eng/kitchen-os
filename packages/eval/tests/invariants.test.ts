import { describe, it, expect } from 'vitest';
import { registry } from '../invariants.js';
import type { Fixture } from '../fixtures/index.js';

// Інваріанти самі бувають неправі, і тоді вони брешуть дорожче за модель:
// червоний на правильній відповіді відправляє шукати баг там, де його немає.
// calendar-lent флапав чотири рази; учетверте виявилось, що модель відповіла
// бездоганно, а корінь «курк» знайшовся в КУРКУМІ.

const fx = {} as Fixture;
const proposal = (...parts: string[]) => ({
  raw: '',
  card: {
    type: 'proposal',
    items: parts.map((p) => ({ title: p, needs: [], rescues: [] })),
  },
});

describe('lent-no-meat-or-dairy', () => {
  const inv = registry['lent-no-meat-or-dairy']!;

  it('куркума — це спеція, не курка', () => {
    const v = inv(proposal('Нутова юшка з грибами, куркума або паприка'), fx);
    expect(v.pass, v.detail).toBe(true);
  });

  it('справжня птиця ловиться', () => {
    expect(inv(proposal('Куряче філе на пательні'), fx).pass).toBe(false);
    expect(inv(proposal('Індичка з рисом'), fx).pass).toBe(false);
  });

  it('пісна пропозиція проходить', () => {
    const v = inv(proposal('Гриби смажені з нутом', 'Ризото з грибами'), fx);
    expect(v.pass, v.detail).toBe(true);
  });

  // Захисти, які вже стояли в коді — щоб правка їх не збила.
  it('раніші винятки не зламані', () => {
    expect(inv(proposal('Фаршировані гриби'), fx).pass).toBe(true);
    expect(inv(proposal('Гриби дають мʼясистість'), fx).pass).toBe(true);
  });
});
