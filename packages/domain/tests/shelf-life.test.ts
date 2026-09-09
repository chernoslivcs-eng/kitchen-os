// Б2: покриття каталогу правилами й поведінка арбітра.
//
// Головне, що стереже цей файл, — НЕ конкретні числа днів (вони ще
// уточнюватимуться звіркою з відкритим набором), а те, що правила накривають
// каталог. Позиція, яку не накрило жодне правило, мовчки провалюється в
// таблицю зон — і саме такий мовчазний провал найважче помітити.

import { describe, it, expect } from 'vitest';
import { CATALOG } from '@kitchen/catalog/seed';
import { shelfRuleFor, shelfSealedDays, SHELF_RULES } from '../shelf-life.js';

describe('покриття каталогу правилами строків', () => {
  it('правила накривають переважну більшість із 4985 позицій', () => {
    const covered = CATALOG.filter((i) => shelfRuleFor(i.categories)).length;
    // Ті, кого не накрило, працюють за таблицею зон — це безпечний, але грубий
    // запасний варіант. Поріг тут не косметичний: якщо покриття просяде,
    // строки тихо повернуться до плоскої зони, і ніхто цього не побачить.
    expect(covered / CATALOG.length).toBeGreaterThan(0.95);
  });

  it('жодне правило не мертве — кожне ловить хоч одну позицію каталогу', () => {
    // Мертве правило означає одруківку в токені категорії: воно виглядає як
    // покриття, а не робить нічого.
    const hits = new Map(SHELF_RULES.map((r) => [r, 0]));
    for (const item of CATALOG) {
      const r = shelfRuleFor(item.categories);
      if (r) hits.set(r, hits.get(r)! + 1);
    }
    const dead = SHELF_RULES.filter((r) => hits.get(r) === 0).map((r) => r.when[0]);
    expect(dead, 'правила без жодного збігу').toEqual([]);
  });
});

describe('зона як арбітр', () => {
  it('у своїй зоні працює каталог, у чужій — таблиця зон', () => {
    // `Помідори пелаті` — консерва з `dry`. У своїй зоні каталог каже
    // «не псується»; у зоні `fresh` (куди позицію заводить помилка резолвера
    // на свіжих помідорах) каталогу не вірять, і строк дає зона.
    expect(shelfSealedDays('pomodori_pelati', 'dry')).toBeNull();
    expect(shelfSealedDays('pomodori_pelati', 'fresh')).toBeUndefined();
  });

  it('невідомий ключ і порожній ключ — мовчання, а не здогад', () => {
    expect(shelfSealedDays(null, 'fridge')).toBeUndefined();
    expect(shelfSealedDays('такого_ключа_немає', 'fridge')).toBeUndefined();
  });

  it('цибуля живе місяцями, хліб — дні, хоч обидва в «своїх» зонах', () => {
    expect(shelfSealedDays('onion_yellow', 'fresh')).toBe(120);
    expect(shelfSealedDays('bread_baguette', 'dry')).toBe(3);
  });
});
