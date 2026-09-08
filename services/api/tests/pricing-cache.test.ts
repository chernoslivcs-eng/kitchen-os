// Крок А4а: ціна кешу.
//
// Тут стояло хибне твердження — «кешовані вже входять в input_tokens» — і
// формула віднімала одне з одного. Це неправда, і неправда дорога: на проді
// 69 зі 105 вересневих рядків мають cached > input, тобто на двох третинах
// викликів свіжий вхід обнулявся й рахувався як безкоштовний.
//
// Другий наслідок був тихішим і гіршим: max(0, …) робила ціну НЕЛІНІЙНОЮ.
// Зведення рахує по згорнутих групах, Пульс — по рядках, і два екрани
// показували різні гроші за той самий день. Лінійність — не естетика формули,
// а те, завдяки чому вони сходяться.

import { describe, it, expect } from 'vitest';
import { priceOf, priceFor } from '../src/pricing.js';

const SONNET = 'claude-sonnet-4-5';
const row = (input: number, cached: number, output = 0) => ({
  model: SONNET, input_tokens: input, cached_tokens: cached, output_tokens: output,
});

describe('ціна виклику', () => {
  it('три окремі лічильники, кожен за своєю ставкою — жодних віднімань', () => {
    const p = priceFor(SONNET)!;
    // Мільйон свіжих + мільйон кешованих + мільйон вихідних.
    expect(priceOf(row(1_000_000, 1_000_000, 1_000_000)))
      .toBeCloseTo(p.input + p.cached + p.output, 9);
  });

  it('кеш БІЛЬШИЙ за вхід — звичайний рядок, а не привід обнулити вхід', () => {
    // Саме такий вигляд має дві третини проду: input 1991, cached 22710.
    // Стара формула рахувала свіжий вхід нулем і втрачала на ньому гроші.
    const p = priceFor(SONNET)!;
    const usd = priceOf(row(1991, 22710, 326))!;
    expect(usd).toBeCloseTo((1991 * p.input + 22710 * p.cached + 326 * p.output) / 1e6, 9);
    // Свіжий вхід оплачено: без нього вийшло б помітно менше.
    expect(usd).toBeGreaterThan((22710 * p.cached + 326 * p.output) / 1e6);
  });

  it('ЛІНІЙНА: ціна суми = сума цін. На цьому сходяться Зведення й Пульс', () => {
    // Головний тест кроку. Зведення ставить ціну на ЗГОРНУТИХ групах, Пульс —
    // на рядках. Поки формула була нелінійною, вони розходились на 25%.
    const rows = [
      row(1991, 22710, 326),
      row(1761, 22710, 218),
      row(6942, 22372, 356),
      row(500_000, 0, 1000),      // рядок без кешу взагалі
      row(0, 30_000, 0),          // і рядок з самим лише кешем
    ];
    const perRow = rows.reduce((n, r) => n + (priceOf(r) ?? 0), 0);
    const grouped = priceOf({
      model: SONNET,
      input_tokens: rows.reduce((n, r) => n + r.input_tokens, 0),
      cached_tokens: rows.reduce((n, r) => n + r.cached_tokens, 0),
      output_tokens: rows.reduce((n, r) => n + r.output_tokens, 0),
    })!;
    expect(grouped).toBeCloseTo(perRow, 9);
  });

  it('лінійність тримається й на випадкових числах, не лише на підібраних', () => {
    // Підібрані числа — це підказка. Випадкові показують, що властивість
    // справді властивість, а не збіг.
    let seed = 42;
    const rnd = () => Math.floor((seed = (seed * 1103515245 + 12345) % 2147483648) / 1000);
    for (let attempt = 0; attempt < 25; attempt++) {
      const rows = Array.from({ length: 7 }, () => row(rnd(), rnd(), rnd()));
      const perRow = rows.reduce((n, r) => n + (priceOf(r) ?? 0), 0);
      const grouped = priceOf({
        model: SONNET,
        input_tokens: rows.reduce((n, r) => n + r.input_tokens, 0),
        cached_tokens: rows.reduce((n, r) => n + r.cached_tokens, 0),
        output_tokens: rows.reduce((n, r) => n + r.output_tokens, 0),
      })!;
      expect(grouped).toBeCloseTo(perRow, 9);
    }
  });

  it('невідома модель — і далі null, а не нуль', () => {
    expect(priceOf({ model: 'llama-3', input_tokens: 1e6, cached_tokens: 0, output_tokens: 0 })).toBeNull();
  });
});
