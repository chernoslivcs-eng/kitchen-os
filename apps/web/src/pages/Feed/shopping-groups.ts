// Групування списку покупок для панелі (V5).
//
// Групи — за ЧАСОМ і СТАНОМ, а не за категорією товару. Це відповідає на
// головне питання після репліки Кухні: що саме зараз змінилось. Категорія
// («молочне», «овочі») відповідала б на інше питання — «де це в магазині», —
// і для нього є зона в самій позиції.
import type { ShoppingItem } from '../../api';

export type GroupKey = 'fresh' | 'earlier' | 'bought';

export interface ShoppingGroups {
  fresh: ShoppingItem[];
  earlier: ShoppingItem[];
  bought: ShoppingItem[];
  toBuy: number;
}

// Мітка джерела — саме вона показує, як модель зрозуміла запит, і дозволяє
// відкотити не весь список, а конкретне джерело.
// 'model' — це чек: список поповнює модель лише розбором чека, бо картку
// shopping вона дає тільки на прямий запит людини (тоді source = 'user').
const SOURCE_LABEL: Record<ShoppingItem['source'], string> = {
  recipe: 'З РЕЦЕПТА',
  model: 'З ЧЕКА',
  retail: 'З ЧЕКА',
  user: 'РУЧНА',
};

export function sourceLabel(item: ShoppingItem): string {
  return SOURCE_LABEL[item.source] ?? 'РУЧНА';
}

// «Щойно додано» живе до кінця сесії, а не N хвилин: дельта має сенс саме
// в межах розмови, у якій її додали. Після кінця сесії група розчиняється
// в «раніше», і скасовувати вже нічого — рівно як каже V5.
export function groupShopping(items: ShoppingItem[], sessionStartedAt: string | null): ShoppingGroups {
  const since = sessionStartedAt ? new Date(sessionStartedAt).getTime() : Infinity;
  const out: ShoppingGroups = { fresh: [], earlier: [], bought: [], toBuy: 0 };
  for (const it of items) {
    if (it.checked) { out.bought.push(it); continue; }
    out.toBuy += 1;
    if (new Date(it.created_at).getTime() >= since) out.fresh.push(it);
    else out.earlier.push(it);
  }
  return out;
}
