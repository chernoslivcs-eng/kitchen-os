// Р1: мапа категорія → ключ іконки; невідоме — ковпак.
import { describe, it, expect } from 'vitest';
import { dishIcon, DISH_ICON } from './dish-icon';
import { DISH_CATEGORIES } from '@kitchen/domain/dish-category';
import { ICONS } from '../components/Icon/icons';

describe('dishIcon', () => {
  it('кожна категорія має ключ, і кожен ключ існує в наборі іконок', () => {
    for (const c of DISH_CATEGORIES) expect(ICONS).toHaveProperty(DISH_ICON[c]);
  });
  it('назва → існуючий гліф; поки без гліфа — ковпак; невідоме/порожнє — ковпак', () => {
    expect(dishIcon('Бабусин борщ')).toBe('cook.soup');
    expect(dishIcon('Салат із бурратою')).toBe('cook.salad');
    expect(dishIcon('Тости з лососем')).toBe('cook.sandwich');
    expect(dishIcon('Клафуті зі сливами')).toBe('cook.dessert');
    expect(dishIcon('Омлет із сиром')).toBe('cook.breakfast');
    expect(dishIcon('Спагеті карбонара')).toBe('cook.type'); // pasta — гліф ще не намальовано
    expect(dishIcon('Щось смачне')).toBe('cook.type');
    expect(dishIcon(null)).toBe('cook.type');
  });
});
