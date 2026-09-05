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

// ----- Крок 3: серіалізація в промт (§3) ------------------------------------

import type { Profile, MemoryNote } from './types.js';

const PROFILE_BLOCK = '[ПРО ЛЮДИНУ — її власні слова]';
const NOTES_BLOCK = '[НОТАТКИ — записав сам після розмов і готувань]';
const KIT_DEFAULTS_NOTE = `(${KIT_DEFAULTS.map((k, i) => (i === 0 ? k[0]!.toUpperCase() + k.slice(1) : k)).join(', ')} — є за замовчуванням.)`;

/** Рядок поля: початок речення + текст як є; крапка в кінці — одна. */
function sentence(key: ProfileFieldKey, v: ProfileFieldValue): string | null {
  const { lead } = PROFILE_FIELDS[key];
  if (v.status === 'none') return `${lead} — нічого такого.`;
  if (v.status !== 'filled' || !v.text.trim()) return null;
  const body = v.text.trim().replace(/\.+$/, '');
  const line = `${lead} ${body}.`;
  // Єдине, чого людина не писала: база кухні (§3).
  return key === 'kit' ? `${line} ${KIT_DEFAULTS_NOTE}` : line;
}

function noteDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Блок [ПРО ЛЮДИНУ] + [НОТАТКИ] дослівно за §3. Порожні поля пропускаються,
 * `none` → «— нічого такого», у kit завжди дужка про базу. Порожній профіль
 * — блок присутній і каже, що не питали (M13-ROLE-VOICE п.1: тиша — не
 * дозвіл). Нотатки — останні NOTES_IN_PROMPT не видалених, найновіша згори.
 */
export function serializeProfileText(p: ProfileText, notes: ProfileNote[]): string {
  const lines = PROFILE_FIELD_KEYS.map((k) => sentence(k, p.fields[k])).filter((l): l is string => !!l);
  const head = lines.length
    ? `\n\n${PROFILE_BLOCK}\n${lines.join('\n')}\n`
    : `\n\n${PROFILE_BLOCK} порожньо — людина ще нічого про себе не казала. Це НЕ означає, що обмежень немає: найімовірніше, ще не питали.\n`;
  const live = notes
    .filter((n) => !n.deleted_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, NOTES_IN_PROMPT);
  const tail = live.length
    ? `\n${NOTES_BLOCK}\n${live.map((n) => `${noteDate(n.created_at)} — ${n.text}`).join('\n')}`
    : `\n${NOTES_BLOCK} порожньо — нотаток ще немає.`;
  return head + tail;
}

// ----- Крок 3: TS-двійник міграції 0023 ----------------------------------
// Потрібен eval-у (фікстури описують профіль у старій формі) і тестам як
// друге джерело правди про перенесення. Правила — ті самі, що в SQL:
// allergy → ban через кому; anti + wish зі словника пресетів → no через «. »;
// решта wish → love; equip → kit («є» через кому, lacks — «Немає: …»).

const PRESET_RE = new RegExp(`(${VETO_PRESETS.flatMap((p) => p.stems).join('|')})`);
export const matchesVetoPreset = (phrase: string): boolean => PRESET_RE.test(phrase.toLowerCase());

export function profileTextFromLegacy(p: Profile | null | undefined, updated_at: string | null = null): ProfileText {
  const out = emptyProfileText(p?.user_id ?? '');
  if (!p) return out;
  const put = (key: ProfileFieldKey, text: string) => {
    const t = clampProfileText(key, text);
    if (t) out.fields[key] = { text: t, status: 'filled', updated_at };
  };
  if (p.allergies.length) put('ban', p.allergies.join(', '));
  const presetWishes = p.wishes.filter(matchesVetoPreset);
  const otherWishes = p.wishes.filter((w) => !matchesVetoPreset(w));
  if (p.antipatterns.length || presetWishes.length) put('no', [...p.antipatterns, ...presetWishes].join('. '));
  if (otherWishes.length) put('love', otherWishes.join('. '));
  const eq = Object.entries(p.equipment ?? {});
  const has = eq.filter(([, v]) => v === 'has').map(([k]) => k).sort();
  const lacks = eq.filter(([, v]) => v === 'lacks').map(([k]) => k).sort();
  const kit = [has.length ? has.join(', ') : null, lacks.length ? `Немає: ${lacks.join(', ')}` : null].filter(Boolean).join('. ');
  if (kit) put('kit', kit);
  return out;
}

export function profileNotesFromLegacy(notes: MemoryNote[]): ProfileNote[] {
  return notes.map((n) => {
    const text = Array.from(n.kind === 'intent' ? `хотів: ${n.text}` : n.text).slice(0, NOTE_TEXT_LIMIT).join('');
    return {
      id: n.id, user_id: n.user_id, subject: null, text, source: 'user',
      created_at: n.created_at, deleted_at: null, norm_hash: noteHash(text),
    };
  });
}

/** Картка append (§4): дописати через «. », обрізати по ліміту; truncated — щоб репліка могла сказати, що не влізло. */
export function appendProfileText(key: ProfileFieldKey, before: string, add: string): { text: string; truncated: boolean } {
  const base = before.trim().replace(/[.\s]+$/, '');
  const joined = base ? `${base}. ${add.trim()}` : add.trim();
  const text = clampProfileText(key, joined);
  return { text, truncated: Array.from(joined.trim()).length > Array.from(text).length };
}
