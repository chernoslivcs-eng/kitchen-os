import { describe, it, expect } from 'vitest';
import { serializeShopping } from '../context.js';
import type { ShoppingItemRow } from '../types.js';

// M13-ROLE-VOICE п.1. Порожній блок і ВІДСУТНІЙ блок — різні речі.
//
// «Скільки води в склянці?» — «склянка порожня» це відповідь. Склянки немає
// взагалі — питання втрачає ґрунт, і модель добудовує стан із розмови.
//
// [КОМОРА] присутня завжди і несе шапку «ПОВНИЙ перелік станом на зараз».
// Решта блоків при порожньому значенні зникали безслідно — і найсильніший
// захист від вигадок стояв рівно на єдиному блоці, який ніколи не зникає.
// role.md при цьому наказує «подивись у блок» і забороняє казати «блок
// порожній»: модель посилали до джерела, якого немає, і забороняли зізнатись.

function item(over: Partial<ShoppingItemRow> = {}): ShoppingItemRow {
  return {
    id: 's1', household_id: 'h1', label: 'молоко', reason: null,
    value: 1, unit: 'l', zone: null, checked: false, added_by: null,
    source: 'user', created_at: '2026-09-01T10:00:00.000Z',
    ...over,
  };
}

describe('[СПИСОК ПОКУПОК] присутній завжди', () => {
  it('порожній список — блок є і прямо каже, що порожньо', () => {
    const s = serializeShopping([]);
    expect(s).toContain('[СПИСОК ПОКУПОК]');
    expect(s).toMatch(/порожн/i);
  });

  it('непорожній список серіалізується як раніше', () => {
    const s = serializeShopping([item()]);
    expect(s).toContain('[СПИСОК ПОКУПОК]');
    expect(s).toContain('молоко');
    expect(s).not.toMatch(/порожн/i);
  });
});
