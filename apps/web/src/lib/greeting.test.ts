import { describe, it, expect } from 'vitest';
import { greeting, GREETING, EVENING_FROM } from './greeting';

// Текст тут навмисно не повторюється: він тимчасовий (03.10, власник добирає
// остаточний), і тест, який знає слова, перетворив би заміну рядка на правку
// двох місць. Прибита поведінка, не копірайт.
describe('вітання на порожньому екрані', () => {
  const at = (h: number) => new Date(2026, 8, 13, h, 0, 0);

  it('межа — 16:00: до неї денний рядок, з неї вечірній', () => {
    expect(greeting(at(0))).toBe(GREETING.day);
    expect(greeting(at(EVENING_FROM - 1))).toBe(GREETING.day);
    expect(greeting(at(EVENING_FROM))).toBe(GREETING.evening);
    expect(greeting(at(23))).toBe(GREETING.evening);
  });

  it('рядки різні й непорожні — інакше межа ні про що', () => {
    expect(GREETING.day.trim()).not.toBe('');
    expect(GREETING.evening.trim()).not.toBe('');
    expect(GREETING.day).not.toBe(GREETING.evening);
  });
});
