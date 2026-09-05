// Раунд 4 (AUDIT-ROUND-4.md §2.1): сім полів, початки речень і ліміти — одне
// джерело для UI, промту й карток. Файл без node-залежностей навмисно: його
// імпортує браузер (apps/web) через @kitchen/domain/profile-fields; хеші
// нотаток (node:crypto) живуть у profile-text.ts.

export const PROFILE_FIELD_KEYS = ['name', 'no', 'ban', 'love', 'meh', 'kit', 'when'] as const;
export type ProfileFieldKey = (typeof PROFILE_FIELD_KEYS)[number];

export interface ProfileFieldSpec {
  /** Початок речення — те, що стоїть перед текстом людини в промті та UI. */
  lead: string;
  /** Ліміт у символах; сервер обрізає по ньому. */
  limit: number;
  /** Чи будується з поля veto_index (лише `no` і `ban`). */
  indexed: boolean;
}

export const PROFILE_FIELDS: Record<ProfileFieldKey, ProfileFieldSpec> = {
  name: { lead: 'Мене звати', limit: 30, indexed: false },
  no:   { lead: 'Я не їм', limit: 200, indexed: true },
  ban:  { lead: 'Мені не можна', limit: 140, indexed: true },
  love: { lead: 'Я люблю', limit: 200, indexed: false },
  meh:  { lead: 'Я не дуже люблю', limit: 200, indexed: false },
  kit:  { lead: 'У мене на кухні є', limit: 260, indexed: false },
  when: { lead: 'Я зазвичай готую', limit: 250, indexed: false },
};

/** Поля, з яких будується вето. «Я не дуже люблю» сюди не потрапляє ніколи. */
export type VetoField = 'no' | 'ban';

/**
 * empty — ще не відповідали (онбординг спитає);
 * filled — є текст;
 * none — «Нічого такого»: свідомо порожньо, не перепитувати.
 */
export type ProfileFieldStatus = 'empty' | 'filled' | 'none';

export interface ProfileFieldValue {
  text: string;
  status: ProfileFieldStatus;
  updated_at: string | null;
}

export interface ProfileText {
  user_id: string;
  fields: Record<ProfileFieldKey, ProfileFieldValue>;
}

/** База кухні, яку людина не писала — єдина дужка, яку додаємо самі (§3). */
export const KIT_DEFAULTS = ['плита', 'духовка', 'мікрохвильовка', 'холодильник'] as const;

export function emptyProfileText(user_id: string): ProfileText {
  const fields = {} as Record<ProfileFieldKey, ProfileFieldValue>;
  for (const k of PROFILE_FIELD_KEYS) fields[k] = { text: '', status: 'empty', updated_at: null };
  return { user_id, fields };
}

/** Обрізка по ліміту поля — по символах (code points), не по байтах і не по UTF-16 одиницях. */
export function clampProfileText(key: ProfileFieldKey, text: string): string {
  const t = text.trim();
  const chars = Array.from(t);
  const { limit } = PROFILE_FIELDS[key];
  return chars.length > limit ? chars.slice(0, limit).join('').trimEnd() : t;
}
