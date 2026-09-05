// Раунд 4 (AUDIT-ROUND-4.md, §2): профіль як сім речень.
//
// Сім полів, початки речень і ліміти — ОДНЕ джерело для UI, промту й карток.
// Ліміти — з дизайну (Профіль v6), не міняти. Поле — не список фраз, а текст
// людини її словами: модель читає його дослівно, а не через наш переказ.

import { createHash } from 'node:crypto';

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

// ----- Нотатки (§2.2) -------------------------------------------------------

export const NOTE_TEXT_LIMIT = 140;
/** У промт ідуть останні N не видалених. */
export const NOTES_IN_PROMPT = 10;

export interface ProfileNote {
  id: string;
  user_id: string;
  /** Раунд 5 (родина, гості). Поки завжди null. */
  subject: string | null;
  text: string;
  source: 'assistant' | 'user';
  created_at: string;
  /** Мʼяке видалення — для «Повернути». */
  deleted_at: string | null;
  /** noteHash(text) — для дедупу. */
  norm_hash: string;
}

/**
 * Нормалізований хеш тексту нотатки. МУСИТЬ збігатися з тим, що рахує
 * міграція 0023 у SQL:
 *   md5(btrim(regexp_replace(regexp_replace(lower(text), '[^[:alnum:] ]', '', 'g'), '\s+', ' ', 'g')))
 * Регістр, пунктуація й зайві пробіли — не різниця.
 */
export function normalizeNoteText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function noteHash(text: string): string {
  return createHash('md5').update(normalizeNoteText(text), 'utf8').digest('hex');
}

// ----- Вето-індекс (§2.3) ---------------------------------------------------

export type VetoKind = 'category' | 'product' | 'free';

export interface VetoRow {
  user_id: string;
  field: VetoField;
  kind: VetoKind;
  /** Категорія або key продукту каталогу; null для free. */
  ref: string | null;
  /** Як у тексті людини. */
  label: string;
  /** Прапорець алергії: усе з `ban` + рядки з `no`, де в тексті є «алергі». */
  allergy: boolean;
  /** Раунд 5. Поки завжди null. */
  subject: string | null;
}

export interface VetoPreset {
  id: 'vegan' | 'pescatarian' | 'vegetarian' | 'halal' | 'lent';
  /** Стеми в нижньому регістрі; збіг — підрядок у нормалізованому тексті поля. Матчинг — крок 4. */
  stems: string[];
  /** Категорії каталогу (ієрархія в catalog_ingredient.categories). */
  categories: string[];
}

/**
 * Словник пресетів: фраза → категорії каталогу. Список закритий, розширюється
 * кодом. Міграція 0023 використовує ті самі стеми, щоб відрізнити «веганство»
 * у старих wishes (→ `no`) від «більше риби» (→ `love`); тест sql-arity
 * перевіряє, що вони не розʼїхались.
 */
export const VETO_PRESETS: readonly VetoPreset[] = [
  { id: 'vegan', stems: ['веган', 'нічого тваринного'], categories: ['мʼясо', 'птиця', 'риба', 'морепродукти', 'молочне', 'яйця'] },
  { id: 'pescatarian', stems: ['пескетаріан'], categories: ['мʼясо', 'птиця'] },
  { id: 'vegetarian', stems: ['вегетаріан'], categories: ['мʼясо', 'птиця', 'риба', 'морепродукти'] },
  { id: 'halal', stems: ['халяль'], categories: ['свинина', 'алкоголь'] },
  { id: 'lent', stems: ['пісне', 'пощу', 'постую', 'постуємо'], categories: ['тваринне'] },
];
