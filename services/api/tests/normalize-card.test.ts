// Живий репро 01.09: модель повернула {"type":"shopping","ops":[...]}
// замість items — shopping.items і intake_diff/profile.ops мають майже
// однакову форму елемента ({op,label,...}), тож плутанина між ними
// природна для моделі. normalizeCard перекладає в правильне поле замість
// вигадування даних — той самий рядок, тільки під правильним ключем.
import { describe, it, expect } from 'vitest';
import { normalizeCard } from '../src/model.js';

describe('normalizeCard: items↔ops плутанина', () => {
  it('shopping з ops замість items — переносить у items', () => {
    const c = normalizeCard({ type: 'shopping', ops: [{ op: 'remove', label: 'молоко' }] });
    expect(c).toMatchObject({ type: 'shopping', items: [{ op: 'remove', label: 'молоко' }] });
  });

  it('intake_diff з items замість ops — переносить у ops', () => {
    const c = normalizeCard({ type: 'intake_diff', items: [{ op: 'add', label: 'молоко' }] });
    expect(c).toMatchObject({ type: 'intake_diff', ops: [{ op: 'add', label: 'молоко' }] });
  });

  it('правильна форма — не чіпає', () => {
    const shopping = { type: 'shopping', items: [{ op: 'add', label: 'сіль' }] };
    expect(normalizeCard(shopping)).toEqual(shopping);
  });

  it('нема чим рятувати (ні items, ні ops) — повертає як є, не вигадує', () => {
    const c = normalizeCard({ type: 'shopping' });
    expect(c).toEqual({ type: 'shopping' });
  });

  it('не картка (null/не обʼєкт) — null', () => {
    expect(normalizeCard(null)).toBeNull();
    expect(normalizeCard('текст')).toBeNull();
  });
});

// П5-В4: модель може й далі слати картку profile — промпт її більше не
// описує, але моделі бувають упертими, а прод і промпт роз'їжджаються рівно
// на одному деплої. Голу картку гейтить CHAT_CARD_TYPES; обгортку
// {reply, card} — ні, і саме нею приходять маркери ходу. Тому питання тут
// інше: чи є в продукту така родина взагалі (CARD_APPLY_MODE).
describe('normalizeCard: родина, якої продукт не знає', () => {
  it('profile після П5 — null, а не порожня рамка в стрічці', () => {
    expect(normalizeCard({ type: 'profile', field: 'no', mode: 'append', text: 'селери' })).toBeNull();
    expect(normalizeCard({ type: 'profile', ops: [{ op: 'add', kind: 'member', label: 'Оксана' }] })).toBeNull();
  });

  it('вигаданий тип — теж null', () => {
    expect(normalizeCard({ type: 'wishlist', items: [] })).toBeNull();
  });

  it('маркери ходу проходять: вони не в CHAT_CARD_TYPES, але родина жива', () => {
    expect(normalizeCard({ type: 'cook_go', title: 'Шакшука' })).toMatchObject({ type: 'cook_go' });
    expect(normalizeCard({ type: 'cart_go', items: [] })).toMatchObject({ type: 'cart_go' });
    expect(normalizeCard({ type: 'retail_search_go', query: 'тофу' })).toMatchObject({ type: 'retail_search_go' });
  });
});
