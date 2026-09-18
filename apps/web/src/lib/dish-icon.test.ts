// Р1: мапа категорія → ключ іконки; невідоме — ковпак.
import { describe, it, expect } from 'vitest';
import { dishIcon, DISH_ICON } from './dish-icon';
import { DISH_CATEGORIES } from '@kitchen/domain/dish-category';
import { ICONS } from '../components/Icon/icons';

describe('dishIcon', () => {
  it('кожна категорія має ключ, і кожен ключ існує в наборі іконок', () => {
    for (const c of DISH_CATEGORIES) expect(ICONS).toHaveProperty(DISH_ICON[c]);
  });
  it('назва → існуючий гліф; невідоме/порожнє — ковпак', () => {
    expect(dishIcon('Бабусин борщ')).toBe('dish.soup');
    expect(dishIcon('Салат із бурратою')).toBe('dish.salad');
    expect(dishIcon('Тости з лососем')).toBe('dish.sandwich');
    expect(dishIcon('Клафуті зі сливами')).toBe('dish.dessert');
    expect(dishIcon('Омлет із сиром')).toBe('dish.breakfast');
    expect(dishIcon('Спагеті карбонара')).toBe('dish.pasta');
    expect(dishIcon('Щось смачне')).toBe('cook.type');
    expect(dishIcon(null)).toBe('cook.type');
  });
  it('усі 20 категорій мають окремий гліф (не ковпак)', () => {
    for (const c of DISH_CATEGORIES) expect(DISH_ICON[c]).not.toBe('cook.type');
  });
});
