// decideReassign — три випадки переприсвоєння (не чотири, як decideKey):
// fill / rekey / keep, і мовчання резолвера НІКОЛИ не стирає наявний ключ.

import { describe, it, expect } from 'vitest';
import { decideReassign, exceedsLimit, EXPECTED_MAX } from '../scripts/reassign-catalog-keys-decide.js';

describe('decideReassign: ключа нема, резолвер дає — проставити', () => {
  it('впізнаване доливається суворою планкою', () => {
    const d = decideReassign(null, 'помідори чері', 'помідори чері');
    expect(d.action).toBe('fill');
    expect(d.key).toBe('veg_tomato_cherry');
  });
});

describe('decideReassign: ключ є, резолвер дає інший — переписати', () => {
  it('вершки 33% під ключем 20% — той самий кейс, що decideKey', () => {
    const d = decideReassign('cream_20', 'вершки', 'вершки 33%');
    expect(d.action).toBe('rekey');
    expect(d.key).toBe('cream_33');
  });
  it('друга планка теж уміє переписати, коли сувора мовчить', () => {
    const d = decideReassign('dairy_tan', 'сметана', 'сметана');
    expect(d.action).toBe('rekey');
    expect(d.key).toBe('gen_sour_cream');
  });
});

describe('decideReassign: резолвер підтверджує наявний — не чіпати', () => {
  it('сувора планка каже те саме, що стоїть', () => {
    const d = decideReassign('gen_tomatoes', 'помідори', 'помідори');
    expect(d.action).toBe('keep');
    expect(d.key).toBe('gen_tomatoes');
  });
});

describe('decideReassign: резолвер МОВЧИТЬ — не чіпати НІКОЛИ, ключ НЕ стирається', () => {
  it('той самий кейс, де decideKey сам по собі стирає ключ (rekey.test.ts) — тут key лишається', () => {
    const raw = decideReassign('alc_beer_ale', 'щось незрозуміле', 'щось незрозуміле Brand');
    // Контроль: decideKey (без обгортки) на цьому ж вході дає erase/null —
    // саме ця різниця тут навмисно перемаповується.
    expect(raw.action).toBe('keep');
    expect(raw.key).toBe('alc_beer_ale'); // НЕ null — стертий бути не повинен
  });

  it('ключа нема й резолвер мовчить — лишається порожнім, як і в decideKey (не вигадуємо)', () => {
    const d = decideReassign(null, 'щось незрозуміле', 'щось незрозуміле');
    expect(d.action).toBe('keep');
    expect(d.key).toBeNull();
  });
});

describe('exceedsLimit: захист «переписали пів бази через баг у резолвері»', () => {
  it(`не блокує на очікуваних 8 rekey + 29 fill = 37 (≤ ${EXPECTED_MAX})`, () => {
    expect(exceedsLimit(37)).toBe(false);
  });
  it(`не блокує рівно на межі (${EXPECTED_MAX})`, () => {
    expect(exceedsLimit(EXPECTED_MAX)).toBe(false);
  });
  it(`блокує одразу за межею (${EXPECTED_MAX + 1})`, () => {
    expect(exceedsLimit(EXPECTED_MAX + 1)).toBe(true);
  });
  it('блокує явно завелику кількість (баг у резолвері переписав би половину бази)', () => {
    expect(exceedsLimit(500)).toBe(true);
  });
});

describe('decideReassign ідемпотентний', () => {
  it('другий прогін по вже переприсвоєному нічого не міняє', () => {
    const first = decideReassign('cream_20', 'вершки', 'вершки 33%');
    expect(first.action).toBe('rekey');
    const second = decideReassign(first.key, 'вершки', 'вершки 33%');
    expect(second.action).toBe('keep');
    expect(second.key).toBe('cream_33');
  });

  it('«стертий би» кейс на другому прогоні так само лишається незмінним (не null)', () => {
    const first = decideReassign('alc_beer_ale', 'щось незрозуміле', 'щось незрозуміле Brand');
    expect(first.action).toBe('keep');
    const second = decideReassign(first.key, 'щось незрозуміле', 'щось незрозуміле Brand');
    expect(second.action).toBe('keep');
    expect(second.key).toBe('alc_beer_ale');
  });
});
