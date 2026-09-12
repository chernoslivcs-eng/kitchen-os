import { describe, it, expect } from 'vitest';
import { homeFact } from './homeFact';

const none = { writtenOffToday: null, fast: null, seasonStarted: null, library: null };

describe('факт дому під чіпами порожньої розмови', () => {
  it('пріоритет: списане сьогодні → піст → сезон → бібліотека', () => {
    expect(homeFact({ ...none, writtenOffToday: 'Помідори', fast: { day: 3, total: 46 } }))
      .toBe('«Помідори» більше нема — уперше за тиждень у коморі тихо. Насолоджуйся, це ненадовго.');
    expect(homeFact({ ...none, fast: { day: 12, total: 46 }, seasonStarted: 'гарбузи' }))
      .toBe('Піст день 12 із 46. Фует терпляче чекає травня — він у нас витримує й довше.');
    expect(homeFact({ ...none, seasonStarted: 'гарбузи', library: { saved: 5, cooked: 1 } }))
      .toBe('Сезон «гарбузи» почався. Тепер усе, що ти скажеш, я потайки зводитиму до крем-супу.');
    expect(homeFact({ ...none, library: { saved: 23, cooked: 6 } }))
      .toBe('Ти зберіг 23 рецепти і приготував 6. Решта живе життям, про яке ми не говоримо.');
  });
  it('нічого немає або бібліотека порожня — рядка нема', () => {
    expect(homeFact(none)).toBeNull();
    expect(homeFact({ ...none, library: { saved: 0, cooked: 0 } })).toBeNull();
  });
});
