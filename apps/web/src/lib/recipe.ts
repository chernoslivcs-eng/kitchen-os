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
export function renderStepContent(
  content: string,
  ing: RecipeIngLite[],
  labels?: BatchLabels,
): string {
  return content.replace(/\{(\d+)\}/g, (_, idx) => {
    const i = Number(idx);
    const it = ing[i];
    if (!it) return `{${idx}}`;
    const name = resolveIngName(it, labels);
    if (it.v != null && it.u) return `${name} ${formatQty(it.v, it.u)}`.trim();
    return name;
  });
}
