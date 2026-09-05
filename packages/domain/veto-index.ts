// Раунд 4, крок 4 (AUDIT-ROUND-4.md §2.3): витяг вето-індексу з полів
// «Я не їм» і «Мені не можна». Чиста функція над текстом людини; каталог —
// довідник. Консервативно: що не розвʼязалось — free, і вето його не читає.
//
// Чому не meaningfulWords/root із каталогу: там стоп-словом є «алергія» (а
// нам вона — прапорець), а root ріже дві останні літери і «риби»/«риба» не
// сходяться. Тут — дешевий стемер відмінків, достатній для назв продуктів.

import { CATALOG } from '@kitchen/catalog/seed';
import { normalize, resolveLabel } from '@kitchen/catalog';
import { VETO_PRESETS, PROFILE_FIELDS, type VetoRow, type VetoField, type ProfileFieldKey } from './profile-text.js';
import type { Repo } from './repo.js';

const IRREGULAR: Record<string, string> = { 'яєць': 'яйц', 'яйце': 'яйц' };
// Від довшого до коротшого; лишаємо щонайменше 3 літери.
const ENDINGS = ['ами', 'ями', 'ові', 'еві', 'ого', 'ому', 'ої', 'ій', 'ах', 'ях', 'ам', 'ям', 'ів', 'їв', 'ею', 'ою', 'и', 'і', 'у', 'ю', 'а', 'я', 'е', 'є', 'о', 'ь'];

export function stemUk(word: string): string {
  const w = normalize(word);
  if (IRREGULAR[w]) return IRREGULAR[w]!;
  for (const e of ENDINGS) {
    if (w.length - e.length >= 3 && w.endsWith(e)) return w.slice(0, -e.length);
  }
  return w;
}

// Стоп-слова фрагмента: те, що лишається після них — назва або «free».
const STOP = new Set(['не', 'їм', 'їсти', 'бо', 'ані', 'ні', 'взагалі', 'зовсім', 'ніякого', 'жодного', 'жодної', 'я', 'ми', 'мені', 'нам', 'без', 'з', 'із', 'зі']);

// ----- Довідник категорій каталогу ---------------------------------------
// Категорії йдуть «від конкретного до загального» (seed.ts), тож усе, що стоїть
// правіше, — предки. Стем → категорія: перша (за частотою) з тим самим стемом.

const CATEGORY_COUNT = new Map<string, number>();
const ANCESTORS = new Map<string, Set<string>>();
// Нормалізована назва → як у каталозі («мясо» → «мʼясо»): у ref і в лог іде
// справжня назва категорії, а порівнюємо — нормалізовано.
const CATEGORY_NAME = new Map<string, string>();
for (const item of CATALOG) {
  const cats = item.categories.map(normalize).filter(Boolean);
  item.categories.forEach((raw) => { const n = normalize(raw); if (n && !CATEGORY_NAME.has(n)) CATEGORY_NAME.set(n, raw); });
  cats.forEach((c, i) => {
    CATEGORY_COUNT.set(c, (CATEGORY_COUNT.get(c) ?? 0) + 1);
    // Предки — ПЕРЕТИН хвостів по всіх позиціях, де категорія стоїть, а не
    // обʼєднання: списки не є строгим деревом («готове» в одній позиції
    // сусідить із «мʼясо», в іншій — із «рослинне»), і обʼєднання робило
    // тофу мʼясом. Перетин лишає тільки універсальних предків:
    // яловичина → {мʼясо, тваринне}; готове → {}.
    const tail = new Set(cats.slice(i + 1));
    const prev = ANCESTORS.get(c);
    if (!prev) ANCESTORS.set(c, tail);
    else ANCESTORS.set(c, new Set([...prev].filter((x) => tail.has(x))));
  });
}
const CATEGORIES = new Set(CATEGORY_COUNT.keys());
const STEM_TO_CATEGORY = new Map<string, string>();
for (const [c, n] of [...CATEGORY_COUNT.entries()].sort((a, b) => b[1] - a[1])) {
  if (c.includes(' ')) continue;
  const s = stemUk(c);
  if (!STEM_TO_CATEGORY.has(s) || n > (CATEGORY_COUNT.get(STEM_TO_CATEGORY.get(s)!) ?? 0)) STEM_TO_CATEGORY.set(s, c);
}

/** Категорія каталогу за словом (стем; для стемів від 5 літер — і як префікс: «арахісов…» → арахіс). */
export function categoryOfWord(word: string): string | null {
  const s = stemUk(word);
  if (s.length < 3) return null;
  const exact = STEM_TO_CATEGORY.get(s);
  if (exact) return exact;
  for (const [cs, cat] of STEM_TO_CATEGORY) {
    if (cs.length >= 5 && s.startsWith(cs)) return cat;
  }
  return null;
}

/** Категорія + усі її предки за ієрархією каталогу. */
export function withAncestors(category: string): Set<string> {
  const out = new Set<string>([category]);
  for (const a of ANCESTORS.get(category) ?? []) out.add(a);
  return out;
}

export const isCategory = (name: string): boolean => CATEGORIES.has(normalize(name));
/** Назва категорії як у каталозі (для ref і логів); нормалізована — для порівняння. */
export const categoryName = (norm: string): string => CATEGORY_NAME.get(norm) ?? norm;

// ----- Витяг ---------------------------------------------------------------

const tokens = (fragment: string): string[] => normalize(fragment).split(/\s+/).filter(Boolean);
const isParen = (t: string) => t.startsWith('(') || t.endsWith(')');
const contentWords = (fragment: string) => tokens(fragment).filter((t) => !isParen(t) && !STOP.has(t) && /[\p{L}]/u.test(t));

function label(fragment: string): string {
  // Обрізаємо стоп-слова з країв, дужки лишаємо («кінза (алергія)»).
  const ts = fragment.trim().split(/\s+/);
  let a = 0, b = ts.length;
  while (a < b && STOP.has(normalize(ts[a]!))) a++;
  while (b > a && STOP.has(normalize(ts[b - 1]!))) b--;
  return ts.slice(a, b).join(' ');
}

export function splitVetoFragments(text: string): string[] {
  return text
    .split(/[.,;\n]+|\s+(?:і|й|та|або|а також)\s+/i)
    .map((f) => f.trim())
    .filter(Boolean);
}

export function buildVetoIndex(user_id: string, field: VetoField, text: string): VetoRow[] {
  const out: VetoRow[] = [];
  const seen = new Set<string>();
  const push = (row: Omit<VetoRow, 'user_id' | 'field' | 'subject'>) => {
    const k = `${row.kind}|${row.ref ?? row.label.toLowerCase()}|${row.allergy}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ user_id, field, subject: null, ...row });
  };

  for (const fragment of splitVetoFragments(text)) {
    const norm = normalize(fragment);
    const allergy = field === 'ban' || /алергі/.test(norm);
    const lbl = label(fragment) || fragment.trim();

    const preset = VETO_PRESETS.find((p) => p.stems.some((s) => norm.includes(s)));
    if (preset) {
      for (const c of preset.categories) push({ kind: 'category', ref: categoryName(normalize(c)), label: lbl, allergy });
      continue;
    }

    const words = contentWords(fragment);
    if (!words.length) continue;
    const phrase = words.join(' ');

    // Ціла фраза — категорія («устричний соус», «червона риба»).
    if (CATEGORIES.has(phrase)) { push({ kind: 'category', ref: categoryName(phrase), label: lbl, allergy }); continue; }
    // Одне слово — категорія за стемом («мʼяса» → мʼясо, «кінзи» → кінза).
    if (words.length === 1) {
      const cat = categoryOfWord(words[0]!);
      if (cat) { push({ kind: 'category', ref: categoryName(cat), label: lbl, allergy }); continue; }
    }
    // Продукт каталогу за назвою/аліасом — той самий матчинг, що в коморі.
    const hit = resolveLabel(phrase, 'anchored');
    if (hit) { push({ kind: 'product', ref: hit.key, label: lbl, allergy }); continue; }
    // Кілька слів, кожне — категорія («риби й морепродуктів» уже розрізано; тут — «свіжа риба»).
    const cats = words.map(categoryOfWord).filter((c): c is string => !!c);
    if (cats.length && cats.length === words.length) {
      for (const c of cats) push({ kind: 'category', ref: categoryName(c), label: lbl, allergy });
      continue;
    }
    push({ kind: 'free', ref: null, label: lbl, allergy });
  }
  return out;
}

/**
 * Перебудова індексу поля з того, що зараз у profile_text. Викликається при
 * кожному записі в no/ban (PATCH, картка, undo) і бекфілом для наявних
 * записів. Для полів без індексу (§2.3: meh — ніколи) — no-op.
 */
export async function rebuildVetoIndex(repo: Repo, user_id: string, key: ProfileFieldKey): Promise<VetoRow[]> {
  if (!PROFILE_FIELDS[key].indexed) return [];
  const field = key as VetoField;
  const v = (await repo.getProfileText(user_id)).fields[key];
  const rows = v.status === 'filled' ? buildVetoIndex(user_id, field, v.text) : [];
  await repo.setVetoIndex(user_id, field, rows);
  return rows;
}
