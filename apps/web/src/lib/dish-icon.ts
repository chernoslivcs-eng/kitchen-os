// Р1 (spec 2026-09-18-recipe-card-design): одна іконка на рецепт скрізь —
// превʼю пропозиції, картка, артефакт, бібліотека, шапка кукінг-моду.
// Категорію рахує домен (dishCategory), тут — лише мапа на ключ іконки.
// Тимчасово: 6 наявних гліфів + ковпак; коли доїдуть нові гліфи з дизайну,
// міняється лише ця мапа.
import { dishCategory, type DishCategory } from '@kitchen/domain';
import type { IconName } from '../components/Icon/icons';

export const DISH_ICON: Record<DishCategory, IconName> = {
  soup: 'cook.soup',
  salad: 'cook.salad',
  dough: 'cook.dough',
  sandwich: 'cook.sandwich',
  breakfast: 'cook.breakfast',
  dessert: 'cook.dessert',
  // Гліфів ще нема — ковпак, як і для нерозпізнаного.
  pasta: 'cook.type', meat: 'cook.type', poultry: 'cook.type', fish: 'cook.type', seafood: 'cook.type',
  grain: 'cook.type', veg: 'cook.type', stew: 'cook.type', grill: 'cook.type', drink: 'cook.type',
  sauce: 'cook.type', pancake: 'cook.type', sushi: 'cook.type', burger: 'cook.type',
};

/** Ключ іконки для назви рецепта; невідоме — ковпак. */
export function dishIcon(title: string | null | undefined): IconName {
  const cat = title ? dishCategory(title) : null;
  return cat ? DISH_ICON[cat] : 'cook.type';
}
