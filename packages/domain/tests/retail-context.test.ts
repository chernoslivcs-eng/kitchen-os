import { describe, it, expect } from 'vitest';
import { serializeRetail, buildKitchenContext } from '../context.js';

// Модель відмовляла в замовленні через Сільпо, бо не знала, що інтеграція
// взагалі існує («Я не можу оформити замовлення — це робиться в додатку
// Сільпо»), хоча build-cart уже давно працює. Блок дає їй факт про стан
// мережі — не мовчить, коли підключено, і не мовчить, коли ні (обидва
// стани потребують різної відповіді людині).

describe('[МЕРЕЖІ] в контексті', () => {
  it('undefined (не сконфігуровано на сервері) — жодного токена', () => {
    expect(serializeRetail(undefined)).toBe('');
  });

  it('підключено — модель знає, що може оформити', () => {
    const s = serializeRetail(true);
    expect(s).toContain('[МЕРЕЖІ]');
    expect(s).toContain('Сільпо: підключено');
  });

  it('не підключено — модель знає направити в Профіль, а не мовчати', () => {
    const s = serializeRetail(false);
    expect(s).toContain('[МЕРЕЖІ]');
    expect(s).toContain('не підключено');
    expect(s).toContain('Профіль');
  });

  it('buildKitchenContext прокидає блок', () => {
    const s = buildKitchenContext({ pantry: [], retailConnected: true, now: new Date('2026-06-10') });
    expect(s).toContain('Сільпо: підключено');
  });
});
