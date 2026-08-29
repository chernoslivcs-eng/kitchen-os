// Спільна логіка для трьох екранів, що рендерять Recipe (Recipe, Cook,
// SharedRecipe). Головна вимога — коли модель показує «пальцем» на партію
// комори через `ing.p` = uuid, показати юзеру НАЗВУ, а не uuid, і плейсхолдер
// {0} у step.c замінити тим же людським рядком.

import { formatQty } from './units';

export interface RecipeIngLite {
  p?: string;
  n?: string;
  v?: number;
  u?: string;
}

// Мапа id партії → людський label. Каталог поглиблений: якщо партії з таким id
// у коморі вже нема (вживана в іншому cook run, видалена, ще не завантажилось),
// фолбек — ing.n, а вже потім рядок «інгредієнт».
export type BatchLabels = Map<string, string>;

export function resolveIngName(ing: RecipeIngLite, labels?: BatchLabels): string {
  if (ing.p && labels?.get(ing.p)) return labels.get(ing.p)!;
  if (ing.n) return ing.n;
  return 'інгредієнт';
}

// {0}, {1}, ... у step.c → назва відповідного інгредієнта, з опційною
// кількістю. Дублювалось в Recipe.tsx і Cook.tsx — winесено сюди.
//
// QA3-01 guard: sonnet-4.5 іноді пише і назву словами, і плейсхолдер
// («Часник {1} подрібни»). Промпт це забороняє, але страховка тут: якщо
// перед `{N}` (одразу або через пробіл) стоїть та сама назва інгредієнта —
// прибираємо дублікат. Регістр і закінчення не звіряємо через відмінки —
// перевіряємо збіг перших 3 символів на нижньому регістрі, цього достатньо.
export function renderStepContent(
  content: string,
  ing: RecipeIngLite[],
  labels?: BatchLabels,
): string {
  return content.replace(/(\S*?)\s*\{(\d+)\}/g, (match, before: string, idx: string) => {
    const i = Number(idx);
    const it = ing[i];
    if (!it) return match;
    const name = resolveIngName(it, labels);
    const rendered = it.v != null && it.u ? `${name} ${formatQty(it.v, it.u)}`.trim() : name;
    // Прибираємо назву перед плейсхолдером, якщо це той самий інгредієнт.
    const firstWord = name.split(/\s+/)[0]?.toLowerCase() ?? '';
    if (before && firstWord.length >= 3 && before.toLowerCase().startsWith(firstWord.slice(0, 3))) {
      return rendered;
    }
    return before ? `${before} ${rendered}` : rendered;
  });
}
