import { describe, it, expect } from 'vitest';
import { bankNotice, MERCHANT_LEGAL_NAME } from './paywall.js';

// 26 вересня + 14 днів = 10 жовтня.
const NOW = new Date('2026-09-26T08:00:00.000Z');

describe('bankNotice', () => {
  it('з пробним — називає день першого списання СЛОВАМИ', () => {
    const n = bankNotice(290, true, NOW);
    expect(n.text).toContain('зараз нічого не спише — 0 ₴');
    expect(n.text).toContain('Перше списання 290 ₴ буде 10 жовтня');
    expect(n.text).toContain(MERCHANT_LEGAL_NAME);
  });

  it('дату рахує сам — інакше лендінг і екран «Підписка» показували б різне', () => {
    // Саме так і сталось: «10 жовтня» на лендінгу проти «10.10» на екрані.
    expect(bankNotice(210, true, NOW).text).toBe(bankNotice(210, true, NOW).text);
    expect(bankNotice(210, true, NOW).text).toContain('10 жовтня');
  });

  it('без пробного — не обіцяє конкретного дня', () => {
    const n = bankNotice(210, false, NOW);
    expect(n.text).toContain('протягом доби');
    // Конкретну дату тут ми не контролюємо: списання робить крон.
    expect(n.text).not.toContain('жовтня');
  });

  it('не обіцяє безпеки й не каже «верифікація» — цих слів людина не мусить розбирати', () => {
    for (const trial of [true, false]) {
      const t = bankNotice(290, trial, NOW).text.toLowerCase();
      expect(t).not.toContain('безпеч');
      expect(t).not.toContain('верифікац');
    }
  });
});
