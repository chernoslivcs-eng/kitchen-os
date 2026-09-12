// Пакет 4, №7: від 1000 г — кілограми, від 1000 мл — літри (кадри Screens
// «Комора»: «1,2 кг», «≈ 3 кг»); нижче межі — як було.
import { describe, it, expect } from 'vitest';
import { formatQty } from './units';

describe('formatQty · кілограми й літри', () => {
  it('до 1000 — грами й мілілітри', () => {
    expect(formatQty(999, 'g')).toBe('999 г');
    expect(formatQty(250, 'ml')).toBe('250 мл');
    expect(formatQty(6, 'pcs')).toBe('6 шт');
  });
  it('від 1000 — кг/л, кома, один десятковий, без хвостового нуля', () => {
    expect(formatQty(1000, 'g')).toBe('1 кг');
    expect(formatQty(1250, 'g')).toBe('1,3 кг');
    expect(formatQty(1200, 'g')).toBe('1,2 кг');
    expect(formatQty(3000, 'g')).toBe('3 кг');
    expect(formatQty(1500, 'ml')).toBe('1,5 л');
  });
  it('порожнє й без одиниці — як було', () => {
    expect(formatQty(null, 'g')).toBe('');
    expect(formatQty(5, null)).toBe('5');
  });
});
