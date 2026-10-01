import { describe, it, expect } from 'vitest';
import { bankNotice, MERCHANT_LEGAL_NAME } from './paywall.js';

describe('bankNotice', () => {
  // Один текст на всі випадки (01.10). Доти їх було два, і другий казав
  // «пробний період уже використано» — тому, хто пробного ніколи не мав.
  it('каже, що зараз не спише, і коли спише вперше', () => {
    const n = bankNotice(290);
    expect(n.text).toContain('зараз нічого не спише');
    expect(n.text).toContain('Перше списання 290 ₴ — протягом доби');
    expect(n.text).toContain(MERCHANT_LEGAL_NAME);
  });

  it('не обіцяє конкретного дня: списання робить крон', () => {
    const t = bankNotice(210).text;
    expect(t).not.toMatch(/січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня/);
    expect(t).not.toMatch(/\d{1,2}\.\d{2}/);
  });

  // Слово «пробний» тут було неправдою для демо-дому, а після 01.10 — для всіх.
  it('не згадує пробного — його більше немає', () => {
    expect(bankNotice(210).text.toLowerCase()).not.toContain('пробн');
  });

  // Канарка 28.09: mono віддає merchantName "kitchen-os", і сторінка оплати
  // пише «Оплата для kitchen-os». Раніше тут стояло «ФОП Білянський П. М.» —
  // назва, якої людина на тій сторінці не бачить.
  it('називає рівно того отримувача, що й сторінка банку', () => {
    expect(MERCHANT_LEGAL_NAME).toBe('kitchen-os');
    expect(bankNotice(290).text).toContain('отримувач — «kitchen-os», це ми');
  });

  it('не обіцяє безпеки й не каже «верифікація» — цих слів людина не мусить розбирати', () => {
    const t = bankNotice(290).text.toLowerCase();
    expect(t).not.toContain('безпеч');
    expect(t).not.toContain('верифікац');
  });
});
