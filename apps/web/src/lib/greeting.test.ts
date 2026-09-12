import { describe, it, expect } from 'vitest';
import { vocative, greeting } from './greeting';

describe('кличний відмінок за правилами Prototype', () => {
  it('-я → -ю, -а → -о, -й/-і → -ю, приголосна → +е', () => {
    expect(vocative('Ілля')).toBe('Іллю');
    expect(vocative('Марина')).toBe('Марино');
    expect(vocative('Андрій')).toBe('Андрію');
    expect(vocative('Пилип')).toBe('Пилипе');
  });
  it('решта — як є; порожнє — порожнє', () => {
    expect(vocative('Іво')).toBe('Іво');
    expect(vocative('  ')).toBe('');
  });
});

describe('вітання за часом доби', () => {
  const at = (h: number) => new Date(2026, 8, 13, h, 0, 0);
  it('до 16:00 — «що готуємо?», після — «що на вечерю?»', () => {
    expect(greeting('Пилип', at(10))).toBe('Пилипе, що готуємо?');
    expect(greeting('Пилип', at(16))).toBe('Пилипе, що на вечерю?');
    expect(greeting('Пилип', at(15))).toBe('Пилипе, що готуємо?');
  });
  it('без імені — без звертання, з великої', () => {
    expect(greeting(null, at(19))).toBe('Що на вечерю?');
    expect(greeting('', at(9))).toBe('Що готуємо?');
  });
});
