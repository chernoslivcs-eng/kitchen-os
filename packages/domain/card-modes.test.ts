import { describe, it, expect } from 'vitest';
import { applyMode } from './card-modes.js';

// Знахідка A аудиту: відповідь на питання «чи застосовується ця картка одразу»
// жила в одному `if` усередині chat.ts, а промпт, пост-процесор і eval її
// ПЕРЕКАЗУВАЛИ прозою. Коли `if` змінили (Пул-8 №2, M13 01.09: intake_diff і
// shopping застосовуються без тапу), три перекази лишились на старому місці й
// узгоджено стверджували неправду. Тут — єдине джерело, яке всі троє читають.

describe('режим застосування картки', () => {
  it('сервер застосовує сам, тапу немає — auto', () => {
    expect(applyMode('intake_diff')).toBe('auto');
    expect(applyMode('shopping')).toBe('auto');
  });

  it('картка чекає тапу людини — confirm', () => {
    expect(applyMode('profile')).toBe('confirm');
    expect(applyMode('recipe')).toBe('confirm');
    expect(applyMode('cook_photo')).toBe('confirm');
  });

  it('застосовувати нічого — none', () => {
    expect(applyMode('proposal')).toBe('none');
    expect(applyMode('recipe_link')).toBe('none');
    expect(applyMode('recipe_edit')).toBe('none');
    expect(applyMode('cook_go')).toBe('none');
    expect(applyMode('cart')).toBe('none');
    expect(applyMode('cart_go')).toBe('none');
    expect(applyMode('retail_search_go')).toBe('none');
  });
});
