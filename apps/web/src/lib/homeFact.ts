// Порожня розмова за Prototype (Р140), рядок «факт дому» під чіпами. У
// Prototype це шість жартів (renderVals.joke), що беруться за днем; на проді —
// з реальних даних дому, без моделі, тексти — рівно ті, що в Prototype, з
// підставленими числами й назвами. Пріоритет: списаний сьогодні прострочений
// (і комора тиха) → піст → сезон, що почався цього тижня → бібліотека рецептів;
// інакше — рядка нема. Жарти про гірчиці й мамину цибулю даних не мають — не
// показуються.
import { plural } from './plural';

export interface HomeFactInput {
  /** Списано сьогодні (назва партії) і прострочених у коморі більше нема. */
  writtenOffToday: string | null;
  /** Суворий період: день N із M. */
  fast: { day: number; total: number } | null;
  /** Сезон із каталогу, що почався цього тижня. */
  seasonStarted: string | null;
  /** Бібліотека: збережено і приготовано. null — лічильники ще не приїхали. */
  library: { saved: number; cooked: number } | null;
}

export function homeFact(i: HomeFactInput): string | null {
  if (i.writtenOffToday) {
    // Prototype: «Помідорів більше нема — …». Назву партії підставляємо як є,
    // у лапках — відмінювати чужі назви ми не беремось.
    return `«${i.writtenOffToday}» більше нема — уперше за тиждень у коморі тихо. Насолоджуйся, це ненадовго.`;
  }
  if (i.fast && i.fast.total > 0) {
    return `Піст день ${i.fast.day} із ${i.fast.total}. Фует терпляче чекає травня — він у нас витримує й довше.`;
  }
  if (i.seasonStarted) {
    // Prototype: «Гарбузовий сезон почався. …» — прикметник від назви не
    // збираємо, назва в лапках.
    return `Сезон «${i.seasonStarted}» почався. Тепер усе, що ти скажеш, я потайки зводитиму до крем-супу.`;
  }
  if (i.library && (i.library.saved > 0 || i.library.cooked > 0)) {
    const { saved, cooked } = i.library;
    return `Ти зберіг ${saved} ${plural(saved, ['рецепт', 'рецепти', 'рецептів'])} і приготував ${cooked}. Решта живе життям, про яке ми не говоримо.`;
  }
  return null;
}
