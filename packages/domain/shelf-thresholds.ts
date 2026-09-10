// Пороги свіжості й стан рядка комори. Одне місце (рішення Р2, 10.09).
//
// Драбини ДВІ, і це рішення, не недогляд. Вони відповідають на різні питання:
//   · зріз — «що показати першим» (фільтр «скоро зіпсується»);
//   · шкала — «яким кольором помітити рядок».
// Зводити їх в одну означало б втратити одне з двох. Але жити вони мусять
// поруч, в одному файлі домену — раніше трійка лежала у файлі СТОРІНКИ
// (`apps/web/src/pages/Pantry/filter.ts`), а `Feed.tsx` тримав власну копію
// числа 3 окремим літералом.
//
// Третя драбина — контекстна: мітка `!Nдн` у промті (`context.ts`) бере сьому
// добу. Вона тут названа, щоб число не жило втретє в іншому файлі, але на
// екран не виходить: промт і екран говорять із різними читачами.

/** Зріз «скоро зіпсується»: партія потрапляє у фільтр. */
export const SOON_CUT_DAYS = 3;

/** Шкала рядка: «добігає» починається тут. */
export const FRESH_SOON_DAYS = 5;

/** Шкала рядка: «перевірити» — сьогодні або менше. */
export const FRESH_CHECK_DAYS = 1;

/** Промт: мітка `!Nдн` у рядку комори. На екран не виходить. */
export const CONTEXT_URGENT_DAYS = 7;

/**
 * Стан рядка за часом. Чотири, не три (рішення Р3, 10.09).
 *
 * `overdue` існує окремо саме тому, що раніше його не було: `days <= 0`
 * зводилось у слово «сьогодні» у двох місцях, і девʼятиденне прострочення
 * виглядало як сьогоднішнє. У даних Б1 це 10 позицій зі 113.
 *
 * Імена станів — «Добре · Добігає · Перевірити» (рішення Р22): слово «свіже»
 * позначає ЗОНУ і більше нічого, інакше воно означало б дві різні речі в
 * одному рядку.
 */
export type Freshness = 'good' | 'soon' | 'check' | 'overdue';

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  good: 'Добре',
  soon: 'Добігає',
  check: 'Перевірити',
  overdue: 'Термін вийшов',
};

export function freshness(days: number | null | undefined): Freshness {
  if (days == null) return 'good';
  if (days < 0) return 'overdue';
  if (days > FRESH_SOON_DAYS) return 'good';
  if (days >= FRESH_CHECK_DAYS) return 'soon';
  return 'check';
}

/** Чи потрапляє партія у зріз «скоро зіпсується». Прострочене — потрапляє. */
export function isSoon(days: number | null | undefined): boolean {
  return days != null && days <= SOON_CUT_DAYS;
}

/**
 * Чому строку немає. Порожній `days` — це ДВІ різні речі, і досі вони
 * виглядали однаково:
 *   · `settled` — каталог вирішив «не псується» (сіль, спеції, алкоголь). Це
 *     рішення, а не незнання (див. shelf-life.ts, Р3);
 *   · `unknown` — позиції немає в каталозі, тому строку нема кому порахувати.
 *     У проді таких 17 %.
 * Розрізняємо за `catalog_key`: він і є та ознака, чи каталог узагалі знає цю
 * річ.
 */
export type NoTermReason = 'settled' | 'unknown';

export function noTermReason(catalog_key: string | null | undefined): NoTermReason {
  return catalog_key ? 'settled' : 'unknown';
}

export const NO_TERM_LABEL: Record<NoTermReason, string> = {
  settled: 'не псується',
  unknown: 'без категорії',
};

/**
 * Слово часу в рядку — чотири написання (tokens-v3 · «Слоти рядка комори»).
 * Прострочене подаємо числом («−9 дн»), а не фразою: воно числове, лягає в
 * tabular-nums і не займає рядок. Фраза «термін вийшов» лишається в КАРТЦІ,
 * де є місце (рішення Р3).
 */
export function timeWord(
  days: number | null | undefined,
  catalog_key: string | null | undefined,
  exactDate?: string | null,
): string {
  if (days == null) return NO_TERM_LABEL[noTermReason(catalog_key)];
  if (days < 0) return `−${Math.abs(days)} дн`;
  if (exactDate) return `до ${exactDate}`;
  if (days === 0) return 'сьогодні';
  if (days === 1) return '1 день';
  return `≈ ще ${days} дн`;
}
