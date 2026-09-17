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
    expect(cacheWriteRate(p)).toBe(0);             // 17.09: запис НЕ рахується (cache_creation = cache_read у OpenRouter)
    expect(priceFor('google/gemini-3.8-flash:batch')).not.toBeNull(); // підрядок
    expect(priceFor('google/gemini-2.5-pro')).toBeNull();            // інша модель — інші ціни, не вгадуємо
  });

  // 17.09: живий хід із проду за id генерації — native_tokens_cached 23440 =
  // наш cached = наш cache_write (Anthropic-сумісний ендпойнт OpenRouter
  // віддає cache_creation = cache_read). Рахуємо лише читання: 23440×0.075 +
  // 106×3.75 = $0.0022. OpenRouter total_cost на цьому ході — $0.0032:
  // різниця ≈ $0.001 — їхня плата за зберігання кешу (input_cache_write
  // $0,0417/млн·год), яку токенна формула не бачить. Відоме відхилення;
  // точну ціну дає usd_actual.
  it('priceOf: cache_write_tokens для gemini ігнорується — cost = input + cached + output', () => {
    const usd = priceOf({ model: 'google/gemini-3.8-flash', input_tokens: 0, cached_tokens: 23_440, cache_write_tokens: 23_440, output_tokens: 106 })!;
    expect(usd).toBeCloseTo(0.0021555, 7);
    expect(usd).toBeCloseTo(0.0022, 3);
    const OPENROUTER_TOTAL_COST = 0.0032;
    expect(OPENROUTER_TOTAL_COST - usd).toBeLessThan(0.0015); // зберігання кешу, не токени
    // Без cache_write — та сама ціна: поле не бере участі.
    expect(priceOf({ model: 'google/gemini-3.8-flash', input_tokens: 0, cached_tokens: 23_440, cache_write_tokens: 0, output_tokens: 106 })).toBeCloseTo(usd, 12);
  });

  it('sonnet і haiku — без змін (запис ×1,25)', () => {
    const s = priceFor('anthropic/claude-sonnet-5')!;
    expect(s).toMatchObject({ input: 3, cached: 0.3, output: 15 });
    expect(cacheWriteRate(s)).toBe(3.75);
    expect(cacheWriteRate(priceFor('claude-haiku-4-5-20251001')!)).toBe(1.25);
    expect(priceOf({ model: 'claude-sonnet-5', input_tokens: 1_000_000, cached_tokens: 0, cache_write_tokens: 0, output_tokens: 0 })).toBe(3);
  });
});
