// Крок А5: єдиний тест у проєкті, який звіряється з РЕАЛЬНІСТЮ.
//
// Решта тестів перевіряє, чи код робить те, що ми задумали. Цей перевіряє
// інше й важливіше: чи наше уявлення про ціну збігається з тим, що провайдер
// СПРАВДІ списав. Числа нижче — не з документації (вона змінюється мовчки і
// звірити її нема з чим), а з двох сусідніх рядків OpenRouter Logs за
// 7 вересня 2026, Claude Sonnet 4.5, той самий префікс промпту.
//
//   22:04 · колонка «Input» 24 360, вихід 43  → СПИСАНО $0,0124
//   23:18 · колонка «Input» 24 120, вихід 220 → СПИСАНО $0,0927
//
// Колонка «Input» в OpenRouter — це свіжі ПЛЮС кешовані плюс записані разом;
// наші три окремі лічильники в сумі дають те саме.
//
// Розкладку відновлено арифметикою, і ось чому їй можна вірити:
//
//   Рядок 1 сходиться як 1 650 свіжих + 22 710 із кешу. Якби весь вхід був
//   свіжий, вийшло б $0,0731 — вшестеро більше за списане.
//
//   Рядок 2 сходиться як 1 420 свіжих + 22 700 ЗАПИСАНИХ. Ставку запису тут
//   можна не припустити, а РОЗВ'ЯЗАТИ: ($0,0927 − вихід − свіжі) / 22 700 =
//   $3,7507/млн, тобто рівно 1,25× вхідної ставки.
//
//   І та деталь, що робить розклад достовірним, а не просто арифметично
//   можливим: 22 700 записаних лягають за десять токенів від 22 710
//   прочитаних у першому рядку. Це один префікс — раз записаний, раз
//   прочитаний. У нашій базі за 7 вересня стоїть те саме `cached = 22710`.
//
// ЯКЩО ЦЕЙ ТЕСТ ВПАДЕ — спершу перевіряй прайс, а не тест. Він тримає зв'язок
// із рахунком, і зламати його легко, змінивши ставку «щоб зійшлося».

import { describe, it, expect } from 'vitest';
import { priceOf } from '../src/pricing.js';

const SONNET = 'anthropic/claude-sonnet-4.5';

describe('ціна проти рахунку OpenRouter · 7 вересня 2026', () => {
  it('22:04 — читання з кешу: списано $0,0124', () => {
    const usd = priceOf({
      model: SONNET,
      input_tokens: 1_650,        // свіжі
      cached_tokens: 22_710,      // прочитані з кешу
      cache_write_tokens: 0,
      output_tokens: 43,
    })!;
    // До цента — саме те, що списав провайдер.
    expect(usd).toBeCloseTo(0.0124, 4);
    // І сума лічильників дорівнює колонці «Input» у рахунку.
    expect(1_650 + 22_710).toBe(24_360);
  });

  it('23:18 — запис у кеш: списано $0,0927', () => {
    const usd = priceOf({
      model: SONNET,
      input_tokens: 1_420,           // свіжі
      cached_tokens: 0,              // читати ще нічого — сесія холодна
      cache_write_tokens: 22_700,    // записані в кеш
      output_tokens: 220,
    })!;
    expect(usd).toBeCloseTo(0.0927, 4);
    expect(1_420 + 22_700).toBe(24_120);
  });

  it('без запису той самий рядок вийшов би вшестеро дешевшим — саме це ми й губили', () => {
    const shape = { model: SONNET, input_tokens: 1_420, cached_tokens: 0, output_tokens: 220 };
    const withWrite = priceOf({ ...shape, cache_write_tokens: 22_700 })!;
    const withoutWrite = priceOf({ ...shape, cache_write_tokens: 0 })!;
    expect(withoutWrite).toBeCloseTo(0.0076, 4);
    expect(withWrite / withoutWrite).toBeGreaterThan(10);
  });

  it('той самий префікс: записати в 12,5 раза дорожче, ніж прочитати', () => {
    const write = priceOf({ model: SONNET, input_tokens: 0, cached_tokens: 0, cache_write_tokens: 22_700, output_tokens: 0 })!;
    const read = priceOf({ model: SONNET, input_tokens: 0, cached_tokens: 22_710, cache_write_tokens: 0, output_tokens: 0 })!;
    expect(write / read).toBeCloseTo(12.5, 1);
  });
});

describe('запис у кеш у формулі', () => {
  it('null — це нуль записаних, а не падіння: рядки, старші за міграцію 0032', () => {
    const row = { model: SONNET, input_tokens: 1_000_000, cached_tokens: 0, output_tokens: 0 };
    expect(priceOf({ ...row, cache_write_tokens: null })).toBeCloseTo(3.0, 6);
    expect(priceOf(row)).toBeCloseTo(3.0, 6);   // поля немає взагалі
  });

  it('ціна лишається ЛІНІЙНОЮ і з записом — на цьому сходяться Зведення й Пульс', () => {
    const rows = [
      { model: SONNET, input_tokens: 1_420, cached_tokens: 0, cache_write_tokens: 22_700, output_tokens: 220 },
      { model: SONNET, input_tokens: 1_650, cached_tokens: 22_710, cache_write_tokens: 0, output_tokens: 43 },
      { model: SONNET, input_tokens: 500_000, cached_tokens: 0, cache_write_tokens: null, output_tokens: 1_000 },
    ];
    const perRow = rows.reduce((n, r) => n + (priceOf(r) ?? 0), 0);
    const grouped = priceOf({
      model: SONNET,
      input_tokens: rows.reduce((n, r) => n + r.input_tokens, 0),
      cached_tokens: rows.reduce((n, r) => n + r.cached_tokens, 0),
      cache_write_tokens: rows.reduce((n, r) => n + (r.cache_write_tokens ?? 0), 0),
      output_tokens: rows.reduce((n, r) => n + r.output_tokens, 0),
    })!;
    expect(grouped).toBeCloseTo(perRow, 9);
  });

  it('невідома модель і з записом дає «не знаємо», а не нуль', () => {
    expect(priceOf({ model: 'llama-3', input_tokens: 0, cached_tokens: 0, cache_write_tokens: 1e6, output_tokens: 0 })).toBeNull();
  });
});
