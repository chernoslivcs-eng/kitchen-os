import { describe, it, expect } from 'vitest';
import { deriveSessionTitle } from './session-title.js';

describe('назва сесії', () => {
  it('коротка фраза стає назвою як є', () => {
    expect(deriveSessionTitle('що приготувати з курки')).toBe('Що приготувати з курки');
  });

  it('порожнє — назви немає, краще нічого, ніж «Без назви»', () => {
    expect(deriveSessionTitle('')).toBeNull();
    expect(deriveSessionTitle('   ')).toBeNull();
  });

  it('знімає порожній зачин на початку', () => {
    expect(deriveSessionTitle('слухай, що зробити на вечерю')).toBe('Що зробити на вечерю');
    expect(deriveSessionTitle('привіт! купив молока')).toBe('Купив молока');
  });

  it('те саме слово всередині не чіпає', () => {
    expect(deriveSessionTitle('зроби салат, а потім суп')).toBe('Зроби салат, а потім суп');
  });

  it('бере перше речення, решта — уточнення', () => {
    expect(deriveSessionTitle('Хочу різото. Гриби вже є, вершки треба купити.'))
      .toBe('Хочу різото');
  });

  it('довгу репліку ріже по слову і ставить трикрапку', () => {
    const t = deriveSessionTitle(
      'треба щось придумати на вечерю для чотирьох людей і бажано без духовки',
    )!;
    expect(t.length).toBeLessThanOrEqual(49);
    expect(t.endsWith('…')).toBe(true);
    // Обрубків посеред слова не буває.
    expect(t.slice(0, -1)).toMatch(/\S$/);
    expect('треба щось придумати на вечерю для чотирьох людей і бажано без духовки')
      .toContain(t.slice(0, -1).toLowerCase());
  });

  it('фото замість слів отримує свою назву', () => {
    expect(deriveSessionTitle('[вкладення]')).toBe('Фото в комору');
    expect(deriveSessionTitle('[3 вкладення]')).toBe('Фото в комору');
  });

  it('переноси й подвійні пробіли схлопуються', () => {
    expect(deriveSessionTitle('що  зробити\n\nз рибою')).toBe('Що зробити з рибою');
  });

  it('сама лише пунктуація чи зачин — не назва', () => {
    expect(deriveSessionTitle('...')).toBeNull();
    expect(deriveSessionTitle('ну,')).toBeNull();
    expect(deriveSessionTitle('?!')).toBeNull();
  });

  it('перша літера велика, решта як написала людина', () => {
    expect(deriveSessionTitle('борщ з пампушками')).toBe('Борщ з пампушками');
    expect(deriveSessionTitle('BBQ на вихідні')).toBe('BBQ на вихідні');
  });
});
