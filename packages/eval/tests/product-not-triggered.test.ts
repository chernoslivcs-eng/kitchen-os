import { describe, it, expect } from 'vitest';
import { isProductQuestion } from '@kitchen/domain';

// Раунд 5, крок К1, фікстура product-not-triggered: детерміновано, без моделі.
// Питання про їжу з назвою продукту з каталогу не вмикають [ПРО ДОДАТОК].
describe('product-not-triggered', () => {
  it.each(['як приготувати рибу', 'де купити кінзу'])('«%s» → не про додаток', (t) => {
    expect(isProductQuestion(t)).toBe(false);
  });
  it.each(['як підключити сільпо?', 'де подивитись калорії?', 'як відсканувати штрих-код?', 'що на вечерю і як прибрати нотатку?'])('«%s» → про додаток', (t) => {
    expect(isProductQuestion(t)).toBe(true);
  });
});
