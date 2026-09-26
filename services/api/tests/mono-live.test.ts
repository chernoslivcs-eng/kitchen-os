// Тіла з ЖИВОГО прогону проти тестового mono 26.09 (інвойс 2609269iFQNoirnYUA5s).
// Вони цінніші за синтетичні: саме тут виявилось, що маска лежить не там, де ми
// її читали, а формат маски в mono не «останні чотири».
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { monoToEvent, revealedDigits, type MonoInvoiceStatus } from '../src/billing/mono.js';
import { formatCardMask } from '@kitchen/domain/paywall';

const live = JSON.parse(readFileSync(new URL('./fixtures/mono-live-2609.json', import.meta.url), 'utf8')) as {
  verificationStatus: MonoInvoiceStatus;
  chargeProcessing: MonoInvoiceStatus;
  chargeSuccess: MonoInvoiceStatus;
};

describe('справжні тіла mono · верифікація картки', () => {
  it('маска береться з walletData: paymentInfo у цьому тілі немає ЗОВСІМ', () => {
    expect(live.verificationStatus.paymentInfo).toBeUndefined();
    expect(live.verificationStatus.walletData?.maskedPan).toBe('42424242******42');
    expect(monoToEvent(live.verificationStatus)).toEqual({
      kind: 'subscribed',
      order_id: '32240a47-5090-465d-a5e4-040c69ea51b1',
      card_mask: '42',
      card_token: '260926DqFYNPTM1V1oWE',
    });
  });
});

describe('справжні тіла mono · списання за токеном', () => {
  it('processing — null: рішення принесе наступний вебхук', () => {
    expect(live.chargeProcessing.status).toBe('processing');
    expect(monoToEvent(live.chargeProcessing)).toBeNull();
  });

  it('success — подія з сумою в гривнях і комісією mono', () => {
    expect(monoToEvent(live.chargeSuccess)).toEqual({
      kind: 'success',
      order_id: '32240a47-5090-465d-a5e4-040c69ea51b1',
      amount: 290,
      // 377 копійок на 290 ₴ — рівно 1,3 %, як в їхньому тарифі.
      fee: 3.77,
      provider_payment_id: '260926EJ92sdX5EEVgLJ',
    });
  });

  it('у вебхуку списання paymentInfo.maskedPan таки є — поле існує там, де не потрібне', () => {
    expect(live.chargeSuccess.paymentInfo?.maskedPan).toBe('42424242******42');
  });
});

describe('revealedDigits · формат маски mono', () => {
  it('бере цифри ПІСЛЯ зірочок, а не останні чотири', () => {
    // Тестова картка з самих 4242 приховувала помилку: тут збігається випадково.
    expect(revealedDigits('42424242******42')).toBe('42');
    // А тут «останні чотири з усіх цифр» дали б '1290' для картки на 7890.
    expect(revealedDigits('53754112******90')).toBe('90');
    // Формат із прикладу OpenAPI відкриває чотири — стільки й беремо.
    expect(revealedDigits('444403******1902')).toBe('1902');
  });

  it('без зірочок і без цифр — null, а не вигадка', () => {
    expect(revealedDigits(undefined)).toBeNull();
    expect(revealedDigits('')).toBeNull();
    expect(revealedDigits('****')).toBeNull();
  });
});

describe('formatCardMask', () => {
  it('показує рівно те, що відкрив провайдер', () => {
    expect(formatCardMask('42')).toBe('•••• 42');
    expect(formatCardMask('1902')).toBe('•••• 1902');
  });
  it('немає цифр — немає й крапок: «••••» без числа нічого не означає', () => {
    expect(formatCardMask(null)).toBeNull();
  });
});
