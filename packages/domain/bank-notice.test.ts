import { describe, it, expect } from 'vitest';
import { bankNotice, MERCHANT_LEGAL_NAME } from './paywall.js';

describe('bankNotice', () => {
  it('з пробним — називає день першого списання', () => {
    const n = bankNotice(290, '9 жовтня');
    expect(n.text).toContain('зараз нічого не спише — 0 ₴');
    expect(n.text).toContain('Перше списання 290 ₴ буде 9 жовтня');
    expect(n.text).toContain(MERCHANT_LEGAL_NAME);
  });

  it('без пробного — не обіцяє конкретного дня', () => {
    const n = bankNotice(210, null);
    expect(n.text).toContain('протягом доби');
    // Саме тому, що списання робить крон: конкретну дату ми не контролюємо.
    expect(n.text).not.toMatch(/буде \d/);
  });

  it('не обіцяє безпеки й не каже «верифікація» — цих слів людина не мусить розбирати', () => {
    for (const mask of [null, '9 жовтня']) {
      const t = bankNotice(290, mask).text.toLowerCase();
      expect(t).not.toContain('безпеч');
      expect(t).not.toContain('верифікац');
    }
  });
});
