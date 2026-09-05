// Раунд 4 (AUDIT-ROUND-4.md, §2): профіль як сім речень.
//
// Сім полів, початки речень і ліміти — ОДНЕ джерело для UI, промту й карток.
// Ліміти — з дизайну (Профіль v6), не міняти. Поле — не список фраз, а текст
// людини її словами: модель читає його дослівно, а не через наш переказ.

import { createHash } from 'node:crypto';

export * from './profile-fields.js';
import { PROFILE_FIELD_KEYS, PROFILE_FIELDS, KIT_DEFAULTS, emptyProfileText, clampProfileText, type ProfileFieldKey, type ProfileFieldValue, type ProfileText, type VetoField } from './profile-fields.js';

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
// Крок 4в (7): списки іменників у no/ban/love/meh — через кому («арахіс, кунжут»);
// якщо в наявному або новому тексті є крапка всередині (вже речення) — «. ».
// kit/when/name — завжди «. ».
const LIST_FIELDS: ReadonlySet<ProfileFieldKey> = new Set(['no', 'ban', 'love', 'meh']);
const hasInnerPeriod = (t: string) => /\.\s*\S/.test(t.trim());

export function appendProfileText(key: ProfileFieldKey, before: string, add: string): { text: string; truncated: boolean } {
  const base = before.trim().replace(/[.\s]+$/, '');
  const next = add.trim();
  const sep = LIST_FIELDS.has(key) && !hasInnerPeriod(base) && !hasInnerPeriod(next) ? ', ' : '. ';
  const joined = base ? `${base}${sep}${next}` : next;
  const text = clampProfileText(key, joined);
  return { text, truncated: Array.from(joined.trim()).length > Array.from(text).length };
}

// ----- Крок 4 (a): відкат на проді — картка поля → ops-картка v1 ------------
// Промт один (уже v2). З вимкненим PROFILE_V2 сервер перекладає картку поля
// в стару форму ДО applyMode: no/meh → anti, ban → allergy (по комах),
// love → wish, kit → equip по комах («Немає: …» → note), name/when → note.

import type { ProfileFieldCard, ProfileOpsCard } from './types.js';

const splitCommas = (t: string) => t.split(/[,;]/).map((x) => x.trim()).filter(Boolean);

export function legacyOpsFromFieldCard(card: ProfileFieldCard): ProfileOpsCard {
  const text = (card.text ?? '').trim();
  const ops: ProfileOpsCard['ops'] = [];
  if (!text) return { type: 'profile', ops };
  const add = (kind: ProfileOpsCard['ops'][number]['kind'], label: string, extra: Record<string, unknown> = {}) =>
    ops.push({ op: 'add', kind, label, ...extra });
  switch (card.field) {
    case 'no': case 'meh': add('anti', text); break;
    case 'love': add('wish', text); break;
    case 'ban': for (const l of splitCommas(text)) add('allergy', l); break;
    case 'kit':
      for (const sentence of text.split(/\.\s+|\.$/).map((x) => x.trim()).filter(Boolean)) {
        if (/^немає\s*:/i.test(sentence)) add('note', sentence);
        else for (const l of splitCommas(sentence)) add('equip', l, { has: true });
      }
      break;
    case 'name': case 'when': add('note', `${PROFILE_FIELDS[card.field].lead} ${text}`); break;
  }
  return { type: 'profile', ops };
}

// ----- Крок 7, п. 0: поле за дієсловом людини — механікою, не лише промтом ---
// Флап кроку 4в: «ще не їм кінзи» модель через раз клала в `meh`. Правило
// kitchen-policy те саме («не їм» → no), але тримати його має сервер: якщо в
// репліці людини є «не їм / не їмо / не вживаю / не їсть», а картка прийшла з
// `meh` — поле стає `no` до застосування. Межі слова — кириличні (JS \b їх не
// знає): «нема» чи «неїмо» не рахуються.
export const NO_EAT_VERB_RE = /(?<!\p{L})не\s+(?:їм|їмо|їси|їсть|їсте|їдять|вживаю|вживаємо|вживає|пʼю|п'ю|пʼємо)(?!\p{L})/iu;

export function fieldByVerb<T extends { field: ProfileFieldKey }>(card: T, userText: string): T {
  if (card.field === 'meh' && NO_EAT_VERB_RE.test(userText)) return { ...card, field: 'no' };
  return card;
}
