// Р1 (spec 2026-09-18-recipe-card-design, «Рішення після макета»): одна
// іконка на рецепт скрізь — превʼю пропозиції, картка, артефакт, бібліотека,
// шапка кукінг-моду. Категорію рахує домен (dishCategory), тут — мапа на
// ключ іконки dish.* (усі 20, icons.ts) + ковпак для нерозпізнаного.
// Субпуть, не '@kitchen/domain' — той тягне Repo/node:crypto, і vite у
// браузері падає («Module "node:crypto" has been externalized»); tsc/vitest
// цього не ловлять (той самий принцип, що card-modes.ts, when.ts).
import { dishCategory, type DishCategory } from '@kitchen/domain/dish-category';
import type { IconName } from '../components/Icon/icons';

export const DISH_ICON: Record<DishCategory, IconName> = {
  soup: 'dish.soup',
  salad: 'dish.salad',
  pasta: 'dish.pasta',
  dough: 'dish.dough',
  sandwich: 'dish.sandwich',
  breakfast: 'dish.breakfast',
  dessert: 'dish.dessert',
  meat: 'dish.meat',
  poultry: 'dish.poultry',
  fish: 'dish.fish',
  seafood: 'dish.seafood',
  grain: 'dish.grain',
  veg: 'dish.veg',
  stew: 'dish.stew',
  grill: 'dish.grill',
  drink: 'dish.drink',
  sauce: 'dish.sauce',
  pancake: 'dish.pancake',
  sushi: 'dish.sushi',
  burger: 'dish.burger',
};

/** Ключ іконки для назви рецепта; невідоме — ковпак. */
export function dishIcon(title: string | null | undefined): IconName {
  const cat = title ? dishCategory(title) : null;
  return cat ? DISH_ICON[cat] : 'cook.type';
}
