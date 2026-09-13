// «Факт дому» — рядок 13 muted під чіпами порожньої розмови (Р140, Р146).
//
//   1. Шаблон (перенесено з apps/web/src/lib/homeFact.ts, Р140) — миттєвий рядок
//      без моделі: тексти рівно з Prototype (COPY канон) з підставленими числами.
//      Пріоритет: списаний сьогодні при тихій коморі → піст день N із M → сезон,
//      що почався цього тижня → бібліотека; інакше null.
//   2. Чистка відповіді моделі (Р146): 2–3 речення, разом ≤ 300 знаків, лише
//      текст; довше — зріз по межі останнього повного речення; обривок, емодзі
//      або порожнє — null (лишається шаблон).

export interface HomeFactTemplateInput {
  /** Списано сьогодні (назва партії) і прострочених у коморі більше нема. */
  writtenOffToday: string | null;
  /** Суворий період: день N із M. */
  fast: { day: number; total: number } | null;
  /** Сезон із каталогу, що почався цього тижня. */
  seasonStarted: string | null;
  /** Бібліотека: збережено і приготовано. null — лічильники не приїхали. */
  library: { saved: number; cooked: number } | null;
}

function pluralUk(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100; const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export function homeFactTemplate(i: HomeFactTemplateInput): string | null {
  if (i.writtenOffToday) {
    // Prototype: «Помідорів більше нема — …». Назву партії підставляємо як є,
    // у лапках — відмінювати чужі назви ми не беремось.
    return `«${i.writtenOffToday}» більше нема — уперше за тиждень у коморі тихо. Насолоджуйся, це ненадовго.`;
  }
  if (i.fast && i.fast.total > 0) {
    return `Піст день ${i.fast.day} із ${i.fast.total}. Фует терпляче чекає травня — він у нас витримує й довше.`;
  }
  if (i.seasonStarted) {
    return `Сезон «${i.seasonStarted}» почався. Тепер усе, що ти скажеш, я потайки зводитиму до крем-супу.`;
  }
  if (i.library && (i.library.saved > 0 || i.library.cooked > 0)) {
    const { saved, cooked } = i.library;
    return `Ти зберіг ${saved} ${pluralUk(saved, ['рецепт', 'рецепти', 'рецептів'])} і приготував ${cooked}. Решта живе життям, про яке ми не говоримо.`;
  }
  return null;
}

/** Вихід моделі: 2–3 речення, разом ≤ 300 знаків (власник 13.09; було 220), лише
 *  текст. Довше — зріз по межі останнього повного речення в межах 300; нема такої
 *  межі, обривок, порожньо або з емодзі — null (шаблон). */
export const HOME_FACT_MAX_CHARS = 300;
export const HOME_FACT_MIN_CHARS = 30;
export function cleanHomeFactText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let t = raw.replace(/\s+/g, ' ').trim();
  t = t.replace(/^[«"“]+/, '').replace(/[»"”]+$/, '').trim();
  if (!t) return null;
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t)) return null;
  // Обривок (модель уперлась у max_tokens: без кінцевого знака або коротше за
  // 30) — не рядок; евал 13.09 давав «Помідори вже прострочені на день,».
  if (t.length < HOME_FACT_MIN_CHARS || !/[.!?…»]$/.test(t)) return null;
  if (t.length > HOME_FACT_MAX_CHARS) {
    const head = t.slice(0, HOME_FACT_MAX_CHARS + 1);
    const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('.»'), head.lastIndexOf('!»'));
    if (cut < 20) return null;
    t = head.slice(0, cut + 1).trim();
  }
  return t;
}
