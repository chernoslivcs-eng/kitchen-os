// Бібліотека рецептів — чисті правила екрана (Screens D5).
//
// Стан проти комори рахує сервер (`status`, `have/total`, `missing`,
// `rescues`); тут — лише слово й тон для пігулки і лічильники фільтрів.
// Лічильник живе в кожній пігулці фільтра, а не в шапці: активна пігулка і є
// «те, що під нею» (PLAN §8), «Збережені · N» у сегменті — усі.

import type { SavedRecipe } from '../../api';

export type Filter = 'all' | 'ready' | 'near' | 'cooked';

export const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Усі' },
  { id: 'ready', label: 'Можу зараз' },
  { id: 'near', label: 'Майже' },
  { id: 'cooked', label: 'Готував' },
];

export function matches(r: Pick<SavedRecipe, 'status' | 'cooked_count'>, f: Filter): boolean {
  if (f === 'ready') return r.status === 'ready';
  if (f === 'near') return r.status === 'near';
  if (f === 'cooked') return r.cooked_count > 0;
  return true;
}

export function filterCounts(recipes: Pick<SavedRecipe, 'status' | 'cooked_count'>[]): Record<Filter, number> {
  return {
    all: recipes.length,
    ready: recipes.filter((r) => matches(r, 'ready')).length,
    near: recipes.filter((r) => matches(r, 'near')).length,
    cooked: recipes.filter((r) => matches(r, 'cooked')).length,
  };
}

/** Слово стану в роді, не капс-чіп: «можу зараз» шавлія · «майже» бурштин · «далеко» приглушено. */
export function statusWord(r: Pick<SavedRecipe, 'status'>): { text: string; tone: 'sage' | 'amber' | 'far' } {
  if (r.status === 'ready') return { text: 'можу зараз', tone: 'sage' };
  if (r.status === 'near') return { text: 'майже', tone: 'amber' };
  return { text: 'далеко', tone: 'far' };
}

/** Порядок як на проді: спершу те, що можна робити зараз. */
export function rank(r: Pick<SavedRecipe, 'status'>): number {
  return r.status === 'ready' ? 0 : r.status === 'near' ? 1 : 2;
}
