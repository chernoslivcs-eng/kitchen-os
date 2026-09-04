// Дедуп рецепта за назвою на добу — і коли він НЕ має спрацьовувати.
//
// Ручний тест 04.09 (прогін Б, комора власника): людина приготувала
// «Феттучіне з морепродуктами», дала фідбек «менше вершків і додай лимон»,
// нотатка з recipe лягла (1.2). Далі «дай рецепт феттучіне» → chat повернув
// cook_go з reply «Тримай оновлений рецепт — вершків менше, лимон у кінці»,
// а сервер віддав той самий рецепт із денного кешу: вершки 200 мл, лимона
// нема. Модель пообіцяла, сервер не виконав — той самий клас, що «замінив у
// рецепті» без recipe_edit, тільки тепер брехню створює механіка, а не модель.
//
// Правило: кешований рецепт застарілий, якщо після його створення зʼявилась
// нотатка, яка його стосується — привʼязана до цієї назви або загальна
// (без recipe_title). Тоді генеруємо заново, і recipe_gen побачить нотатку
// в [ВИСНОВКИ З ГОТУВАННЯ].

import type { MemoryNote, RecipeRow } from '@kitchen/domain';

export function recipeStaleByNotes(recipe: Pick<RecipeRow, 'title' | 'requested_title' | 'created_at'>, notes: MemoryNote[]): boolean {
  const made = new Date(recipe.created_at).getTime();
  const titles = [recipe.title, recipe.requested_title].filter((t): t is string => !!t).map((t) => t.trim().toLowerCase());
  return notes.some((n) => {
    if (new Date(n.created_at).getTime() <= made) return false;
    if (!n.recipe_title) return true;
    return titles.includes(n.recipe_title.trim().toLowerCase());
  });
}
