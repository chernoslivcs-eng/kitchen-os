// Крок П3 (6.2): перевірка ФОРМИ картки на межі — до того, як вона потрапить
// у базу.
//
// Тип картки перевірявся й раніше (`CARD_TYPES` у model-response.ts): усе, що
// не з відомого списку, до бази не доходило. Форму не перевіряв ніхто — і
// саме через це в прод потрапила картка `profile` з опами `{op, field, text}`.
// Такої форми немає ні в типах, ні в схемах промпту, ні в apply: компонент
// намалював три порожні прочерки, а «Записати» не застосувало нічого.
//
// Перевіряємо не «за схемою взагалі», а рівно те, що вміє виконати apply:
// картка, яку нема чим застосувати, не має права стати рядком у card_pending.
// Тому список тут короткий і навмисно консервативний — правило одне на тип, і
// кожне посилається на гілку apply, яка його виконує.

import type { Card } from './types.js';

const isArr = (v: unknown): v is unknown[] => Array.isArray(v);
const nonEmptyStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Повертає причину відмови або null, якщо форма відома.
 * Причина — короткий машинний рядок: він іде в інцидент, не людині.
 */
export function cardFormError(card: Card | null | undefined): string | null {
  if (!card || typeof card !== 'object') return null;
  const o = card as unknown as Record<string, unknown>;

  switch (card.type) {
    // apply.ts: гілка `profile` виконує ЛИШЕ op.kind === 'member'. Форма поля
    // профілю ({field, text, mode}) померла в кроці П3: продукт не редагує
    // профіль людини — вона пише його сама.
    case 'profile': {
      if (nonEmptyStr(o.field)) return 'profile:field-form-retired';
      if (!isArr(o.ops) || o.ops.length === 0) return 'profile:no-ops';
      const bad = (o.ops as Record<string, unknown>[]).find(
        (op) => !op || op.kind !== 'member' || !nonEmptyStr(op.label),
      );
      return bad ? 'profile:op-not-member' : null;
    }

    // apply.ts: гілки читають ops/items і без них не роблять нічого.
    case 'intake_diff':
      return isArr(o.ops) && o.ops.length > 0 ? null : 'intake_diff:no-ops';
    case 'shopping':
      return isArr(o.items) && o.items.length > 0 ? null : 'shopping:no-items';
    case 'event':
      return isArr(o.ops) && o.ops.length > 0 ? null : 'event:no-ops';

    // Решта типів має власні обовʼязкові поля, без яких картка порожня.
    case 'proposal':
      return isArr(o.items) && o.items.length > 0 ? null : 'proposal:no-items';
    case 'recipe':
      return o.recipe && typeof o.recipe === 'object' ? null : 'recipe:no-recipe';
    case 'period':
      return nonEmptyStr(o.kind) ? null : 'period:no-kind';

    // Службові маркери й картки, зібрані сервером: форму їм задає не модель.
    default:
      return null;
  }
}
