// «Факт дому» — рядок 13 muted під чіпами порожньої розмови (Р140, Р146).
//
// Дві половини:
//   1. Шаблон (перенесено з apps/web/src/lib/homeFact.ts, Р140) — миттєва
//      відповідь без моделі: тексти рівно з Prototype (COPY канон) з
//      підставленими числами. Пріоритет: списаний сьогодні при тихій коморі →
//      піст день N із M → сезон, що почався цього тижня → бібліотека; інакше null.
//   2. Вхід моделі (Р146, рішення власника 13.09): три короткі списки, зібрані
//      сервером без моделі — горить · сезон · останні страви. Жодних лічильників,
//      чеків, профілю. Усі три порожні — модель не викликається.

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

/** Вхід моделі: рівно те, що збирає сервер (Р146 п. 1). */
export interface HomeFacts {
  /** Прострочені (days < 0) і ті, що спливають за ≤ 3 дні; до 6 позицій. */
  burning: { label: string; days: number }[];
  /** Що зараз у сезоні для дому (увімкнені підписки); почалось цього тижня — окремо; до 6. */
  seasons: { title: string; startedThisWeek: boolean }[];
  /** 3–5 останніх страв із журналу готувань, скільки днів тому. */
  dishes: { title: string; daysAgo: number }[];
}

export function homeFactsEmpty(f: HomeFacts): boolean {
  return f.burning.length === 0 && f.seasons.length === 0 && f.dishes.length === 0;
}

const dayWord = (n: number) => pluralUk(n, ['день', 'дні', 'днів']);

/** Текст для моделі — три рядки, порожні пропускаються (промпт home-fact.md). */
export function serializeHomeFacts(f: HomeFacts): string {
  const lines: string[] = [];
  if (f.burning.length) {
    // «СПЛИВАЄ», не «горить»: слово «горить» — внутрішній жаргон терміновості, який role.md забороняє в мові
    lines.push('СПЛИВАЄ: ' + f.burning.map((b) => b.days < 0
      ? `${b.label} · прострочено ${-b.days} дн`
      : b.days === 0 ? `${b.label} · останній день` : `${b.label} · лишилось ${b.days} дн`).join('; '));
  }
  if (f.seasons.length) {
    lines.push('СЕЗОН: ' + f.seasons.map((s) => s.startedThisWeek ? `${s.title} (почалось цього тижня)` : s.title).join('; '));
  }
  if (f.dishes.length) {
    lines.push('ОСТАННІ СТРАВИ: ' + f.dishes.map((d) => d.daysAgo <= 0 ? `${d.title} · сьогодні`
      : d.daysAgo === 1 ? `${d.title} · вчора` : `${d.title} · ${d.daysAgo} ${dayWord(d.daysAgo)} тому`).join('; '));
  }
  return lines.join('\n');
}

/** Вихід моделі: 1–3 речення, разом ≤ 220 знаків, лише текст. Довше — зрізаємо по
 *  межі останнього повного речення в межах 220 (евал 13.09: у переповнених домах
 *  haiku дає 225–250); нема такої межі, порожньо або з емодзі — null (шаблон). */
export const HOME_FACT_MAX_CHARS = 220;
export function cleanHomeFactText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let t = raw.replace(/\s+/g, ' ').trim();
  t = t.replace(/^[«"“]+/, '').replace(/[»"”]+$/, '').trim();
  if (!t) return null;
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t)) return null;
  if (t.length > HOME_FACT_MAX_CHARS) {
    const head = t.slice(0, HOME_FACT_MAX_CHARS + 1);
    const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('.»'), head.lastIndexOf('!»'));
    if (cut < 20) return null;
    t = head.slice(0, cut + 1).trim();
  }
  return t;
}
