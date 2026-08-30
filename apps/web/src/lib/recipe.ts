// Спільна логіка для трьох екранів, що рендерять Recipe (Recipe, Cook,
// SharedRecipe). Головна вимога — коли модель показує «пальцем» на партію
// комори через `ing.p` = uuid, показати юзеру НАЗВУ, а не uuid, і плейсхолдер
// {0} у step.c замінити тим же людським рядком.

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
  const out = content.replace(/(\S*?)\s*\{(\d+)\}/g, (match, before: string, idx: string) => {
    const i = Number(idx);
    const it = ing[i];
    if (!it) return match;
    // QA5-09: кількість у крок НЕ підставляємо. Вона вже є в списку інгредієнтів,
    // а в тексті ламає фразу: «половиною {4}» ставало «половиною олія оливкова 40 мл».
    const name = resolveIngName(it, labels);
    // Прибираємо назву перед плейсхолдером, якщо це той самий інгредієнт (QA3-01).
    const firstWord = name.split(/\s+/)[0]?.toLowerCase() ?? '';
    if (before && firstWord.length >= 3 && before.toLowerCase().startsWith(firstWord.slice(0, 3))) {
      return name;
    }
    return before ? `${before} ${name}` : name;
  });
  // Капіталізуємо початок кроку і початок кожного речення всередині: плейсхолдер
  // часто стоїть першим, а назва партії приходить із малої. QA6-11: модель пише
  // кілька речень у кроці, тож самого charAt(0) мало — «Соус. часник — продави».
  return out
    .replace(/^\s*\p{Ll}/u, (c) => c.toUpperCase())
    .replace(/([.!?]\s+)(\p{Ll})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}
