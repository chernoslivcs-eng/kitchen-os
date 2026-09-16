// 16.09: ціна google/gemini-3.8-flash (smart-модель проду через OpenRouter) —
// адмінка /admin/money показувала «ціни не знаємо». Запис у кеш для Gemini —
// за звичайною ставкою входу (cache_write_mult 1.0), роздуми вже в
// output_tokens. Sonnet/haiku не міняються.
import { describe, it, expect } from 'vitest';
import { priceOf, priceFor, cacheWriteRate } from '../src/pricing.js';

describe('ціна gemini-3.8-flash', () => {
  it('priceFor знаходить за назвою з префіксом OpenRouter; ставки за станом на 16.09', () => {
    const p = priceFor('google/gemini-3.8-flash')!;
    expect(p).toMatchObject({ input: 0.75, cached: 0.075, output: 3.75 });
    expect(cacheWriteRate(p)).toBe(0.75);          // запис = звичайний вхід, не ×1,25
    expect(priceFor('google/gemini-3.8-flash:batch')).not.toBeNull(); // підрядок
    expect(priceFor('google/gemini-2.5-pro')).toBeNull();            // інша модель — інші ціни, не вгадуємо
  });

  it('priceOf: рядок із cached і cache_write — чотири лічильники, запис за ставкою входу', () => {
    const usd = priceOf({ model: 'google/gemini-3.8-flash', input_tokens: 1_500, cached_tokens: 14_000, cache_write_tokens: 14_000, output_tokens: 600 });
    // 1500×0.75 + 14000×0.075 + 14000×0.75 + 600×3.75 = 1125 + 1050 + 10500 + 2250 = 14925 мкдол.
    expect(usd).toBeCloseTo(0.014925, 9);
  });

  it('холодний і теплий чат-хід: різниця — лише запис проти читання кешу', () => {
    const cold = priceOf({ model: 'google/gemini-3.8-flash', input_tokens: 1_500, cached_tokens: 0, cache_write_tokens: 14_000, output_tokens: 600 })!;
    const warm = priceOf({ model: 'google/gemini-3.8-flash', input_tokens: 1_500, cached_tokens: 14_000, cache_write_tokens: 0, output_tokens: 600 })!;
    expect(cold).toBeCloseTo(0.013875, 9);
    expect(warm).toBeCloseTo(0.004425, 9);
    expect(cold / warm).toBeCloseTo(3.136, 2);
  });

  it('sonnet і haiku — без змін (запис ×1,25)', () => {
    const s = priceFor('anthropic/claude-sonnet-5')!;
    expect(s).toMatchObject({ input: 3, cached: 0.3, output: 15 });
    expect(cacheWriteRate(s)).toBe(3.75);
    expect(cacheWriteRate(priceFor('claude-haiku-4-5-20251001')!)).toBe(1.25);
    expect(priceOf({ model: 'claude-sonnet-5', input_tokens: 1_000_000, cached_tokens: 0, cache_write_tokens: 0, output_tokens: 0 })).toBe(3);
  });
});
