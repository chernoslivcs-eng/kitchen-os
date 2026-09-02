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

// Дисципліна трійки. Кейси взяті з живого прогону 02.09 — це не вигадані
// приклади, а те, що модель справді повернула на чек Сільпо.
describe('triple-discipline', () => {
  const inv = registry['triple-discipline']!;
  const intake = (...ops: Record<string, unknown>[]) => ({
    raw: '', card: { type: 'intake_diff', ops: ops.map((o) => ({ op: 'add', ...o })) },
  });

  it('повна назва з брендом у своєму полі — проходить', () => {
    const v = inv(intake(
      { label: 'крем-брускетта Ponti з чорних оливок', product: 'крем-брускетта', brand: 'Ponti', variant: 'з чорних оливок' },
      { label: 'вода Моршинська негазована', product: 'вода', brand: 'Моршинська', variant: 'негазована' },
    ) as never, {} as never);
    expect(v.pass, v.detail).toBe(true);
  });

  // Живий репро: у label лишився огризок, усе решта поїхало в variant.
  it('огризок у label ловиться', () => {
    const v = inv(intake(
      { label: 'папір', product: 'папір туалетний', variant: 'Zew Pure Moist' },
    ) as never, {} as never);
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/бідніший за трійку/);
  });

  it('бренд у variant при порожньому brand ловиться', () => {
    const v = inv(intake(
      { label: 'напій Schweppes Pink Tonic', product: 'напій', variant: 'Schweppes Pink Tonic' },
    ) as never, {} as never);
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/бренд у variant/);
  });

  it('нуль брендів на весь чек ловиться', () => {
    const v = inv(intake(
      { label: 'булка коричнева', product: 'булка', variant: 'коричнева' },
      { label: 'квас хлібний', product: 'квас', variant: 'хлібний' },
    ) as never, {} as never);
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/жодного brand/);
  });

  // Межа: відсутній variant — не привід чіплятись, не в кожного товару є
  // сорт. А от бренд, якщо він Є, мусить стояти і в label теж: label — це
  // «людська назва цілком», і саме її людина бачить у картці.
  it('без variant — проходить, якщо label повний', () => {
    const v = inv(intake(
      { label: 'сіль кухонна Артемсіль', product: 'сіль кухонна', brand: 'Артемсіль' },
      { label: 'цукор', product: 'цукор' },
    ) as never, {} as never);
    expect(v.pass, v.detail).toBe(true);
  });

  it('бренд є, але його немає в label — ловиться', () => {
    const v = inv(intake(
      { label: 'пармезан тертий', product: 'пармезан', brand: 'Galbani', variant: 'тертий' },
    ) as never, {} as never);
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/galbani/i);
  });
});
