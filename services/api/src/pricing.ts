// Крок О1а: скільки коштував виклик.
//
// Прайсу в проєкті не було взагалі — token_usage рахував токени, а долари
// ніхто. Саме через це юніт-економіка й лишалась невідомою: числа лежали, але
// в неспівставних одиницях (haiku-токен і sonnet-токен коштують по-різному
// вдесятеро).
//
// Ціни — за мільйон токенів, USD. Тримаються тут окремим файлом, а не числом
// усередині сторінки: вони змінюються провайдером, і мають мінятись в одному
// місці, а не в тому, хто малює таблицю.
//
// Кешовані вхідні рахуються за зниженою ставкою — це і є та економія, заради
// якої в token_usage взагалі є колонка cached_tokens.

interface Price { input: number; cached: number; output: number }

// Ключ — підрядок у назві моделі: у проді вона приходить то як
// `claude-haiku-4-5-20251001`, то як `anthropic/claude-haiku-4.5` (OpenRouter),
// і зіставляти повними іменами означало б втрачати половину рядків.
const PRICES: [string, Price][] = [
  ['haiku',  { input: 1.00, cached: 0.10, output: 5.00 }],
  ['sonnet', { input: 3.00, cached: 0.30, output: 15.00 }],
  ['opus',   { input: 15.00, cached: 1.50, output: 75.00 }],
];

export function priceFor(model: string): Price | null {
  const m = model.toLowerCase();
  return PRICES.find(([key]) => m.includes(key))?.[1] ?? null;
}

/**
 * Вартість одного виклику в доларах. Невідома модель — null, а не нуль:
 * «нуль доларів» у таблиці читається як «безкоштовно», а це інша новина, ніж
 * «я не знаю ціни цієї моделі».
 */
export function priceOf(row: {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
}): number | null {
  const p = priceFor(row.model);
  if (!p) return null;
  // Кешовані вже входять в input_tokens у звітах провайдера, тож не додаємо
  // їх ще раз — віднімаємо й рахуємо за своєю ставкою.
  const fresh = Math.max(0, row.input_tokens - row.cached_tokens);
  return (fresh * p.input + row.cached_tokens * p.cached + row.output_tokens * p.output) / 1_000_000;
}
