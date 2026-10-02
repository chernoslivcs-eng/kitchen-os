// Джерело реєстрації: мітки посилання, за яким людина вперше прийшла на сайт
// (utm_source, utm_medium, utm_campaign, utm_content і короткий ref). Потрібні
// маркетингу для одного питання: який канал дає реєстрації й живі кухні.
//
// Файл чистий (жодного node:*) — його бере й веб глибоким шляхом
// `@kitchen/domain/signup-source`, і сервер. Чистка одна на обидва боки, і
// сервер ганяє її ЗНОВУ на всьому, що прийшло від клієнта: localStorage людина
// може переписати руками, а в базу мають лягати лише мітки.
//
// Чого тут немає навмисно: ідентифікаторів кліку (fbclid, gclid) і referrer.
// Перші — це слід конкретної людини в чужій рекламній системі, другий несе
// повну адресу сторінки, з якої прийшли. Мітка каже «який канал», а не «хто».

export const SIGNUP_MARK_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ref'] as const;
export type SignupMarkKey = (typeof SIGNUP_MARK_KEYS)[number];
export type SignupMarks = Partial<Record<SignupMarkKey, string>>;

export const SIGNUP_MARK_MAX = 64;

/** Яким способом народився акаунт. 'invite' — людину запросили в чужий дім. */
export type SignupVia = 'email' | 'google' | 'telegram' | 'invite';

/** Рядок таблиці signup_source (міграція 0052): один на НОВИЙ акаунт, ніколи не переписується. */
export interface SignupSourceRow {
  user_id: string;
  /** Дім, що народився цією реєстрацією. null — запрошений у чужий дім: його мітки джерелом дому не є. */
  household_id: string | null;
  via: SignupVia;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  ref: string | null;
  created_at: string;
}

/**
 * Одна мітка: нижній регістр, пробіли → `_`, лишаються тільки [a-z0-9_.-],
 * не довше 64. Усе, що після цього порожнє, — не мітка.
 *
 * Значення з `@` відкидаємо цілком, а не чистимо: це чиясь пошта в посиланні
 * (розсилки так роблять), і «john.doegmail.com» після чистки лишився б тими
 * самими персональними даними.
 */
export function cleanMark(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.includes('@')) return null;
  const v = raw.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_.-]/g, '').slice(0, SIGNUP_MARK_MAX);
  return v || null;
}

/** Мітки з довільного обʼєкта (тіло запиту, query, JSON з localStorage). null — жодної мітки. */
export function cleanSignupMarks(input: unknown): SignupMarks | null {
  if (!input || typeof input !== 'object') return null;
  const out: SignupMarks = {};
  for (const key of SIGNUP_MARK_KEYS) {
    const v = cleanMark((input as Record<string, unknown>)[key]);
    if (v) out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Мітки з рядка запиту адреси (`?utm_source=…&ref=…`). */
export function signupMarksFromSearch(search: string): SignupMarks | null {
  const params = new URLSearchParams(search);
  const raw: Record<string, string> = {};
  for (const key of SIGNUP_MARK_KEYS) {
    const v = params.get(key);
    if (v != null) raw[key] = v;
  }
  return cleanSignupMarks(raw);
}

/** Мітки назад у рядок запиту — так вони їдуть у GET (вхід через Google, прийняття запрошення). */
export function signupMarksToSearch(marks: SignupMarks | null | undefined): string {
  const params = new URLSearchParams();
  for (const key of SIGNUP_MARK_KEYS) {
    const v = marks?.[key];
    if (v) params.set(key, v);
  }
  return params.toString();
}
