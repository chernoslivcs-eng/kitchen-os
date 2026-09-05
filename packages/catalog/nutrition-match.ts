// Раунд 5, крок Н1 (§3): позиція каталогу → рядок бази БЖВ. Без моделі.
// Правила по порядку: точний збіг нормалізованої назви (або аліаса) → голова
// + жирність («молоко metro chef 2,5%» → «Молоко 2,5%») → категорія + ключове
// слово зі словника (scripts/nutrition/aliases.json) → нічого (estimate).

import type { CatalogItem } from './seed.js';

export interface NutritionAliases {
  brands: string[];
  heads: Record<string, string[]>;
  keywords: { kw: string[]; cat: string; base: string }[];
  /** Маркери обробки (копчене, консерви, ікра, пюре…): для таких назв правила 2–3 не діють. */
  processed?: string[];
}

export type MatchRule = 'exact' | 'alias' | 'head+percent' | 'keyword';
export interface BaseMatch { base: string; rule: MatchRule }

/** Нормалізація для збігу: регістр, апострофи, тире, «2,5» → «2.5», лапки. */
export function normalizeName(s: string): string {
  return s.toLowerCase()
    .replace(/[ʼ'’ʹ`«»"]/g, '')
    .replace(/[—–−]/g, '-')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Зняти бренд і латинські слова: «молоко metro chef 2.5%» → «молоко 2.5%». */
export function stripBrands(norm: string, brands: string[]): string {
  let s = norm;
  for (const b of [...brands].sort((a, z) => z.length - a.length)) {
    s = s.replace(new RegExp(`(^|\\s)${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'g'), ' ');
  }
  s = s.replace(/\b[a-z][a-z0-9.-]*\b/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

const PCT = /(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*%/;

function percentOf(norm: string): { lo: number; hi: number } | null {
  const m = PCT.exec(norm);
  if (!m) return null;
  const lo = Number(m[1]); const hi = m[2] ? Number(m[2]) : lo;
  return { lo, hi };
}

const wordIn = (norm: string, kw: string) => new RegExp(`(^|[^а-яіїєґa-z])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^а-яіїєґa-z])`).test(norm);

export class BaseMatcher {
  private byNorm = new Map<string, string>();
  private headRows: { head: string; base: string; lo: number; hi: number }[] = [];

  private dishes = new Set<string>();

  /** states — стан рядка бази за назвою; «готове» (страви: борщ, лазанья…) через аліас не беремо. */
  constructor(baseNames: string[], private aliases: NutritionAliases, states: Map<string, string> = new Map()) {
    for (const name of baseNames) {
      if (states.get(name) === 'готове') this.dishes.add(normalizeName(name));
      this.byNorm.set(normalizeName(name), name);
      const n = normalizeName(name);
      const p = percentOf(n);
      if (p) {
        // JS \b не знає кирилиці — межа слова руками.
        const head = n.slice(0, PCT.exec(n)!.index).replace(/(^|\s)цільне(?=\s|$)/, ' ').replace(/\s+/g, ' ').trim();
        this.headRows.push({ head, base: name, lo: p.lo, hi: p.hi });
      }
    }
  }

  match(item: Pick<CatalogItem, 'name' | 'aliases' | 'categories'>): BaseMatch | null {
    const norm = normalizeName(item.name);
    const plain = stripBrands(norm, this.aliases.brands);
    // 1. точний збіг назви (з брендом і без) або аліаса. Збіг ПІСЛЯ зняття
    // бренду приймаємо лише коли рядок бази підтверджується категоріями
    // позиції («Lipton Ice Tea лимон» → «лимон» не про фрукт).
    const exactFull = this.byNorm.get(norm);
    if (exactFull) return { base: exactFull, rule: 'exact' };
    const exactPlain = this.byNorm.get(plain);
    if (exactPlain && plain !== norm) {
      const cats = item.categories.map(normalizeName);
      const head = plain.split(' ')[0]!;
      if (cats.some((c) => c === plain || c.includes(head) || plain.includes(c))) return { base: exactPlain, rule: 'exact' };
    }
    // Аліас: «листи для лазаньї» мають аліас «лазанья», але рядок «Лазанья» в
    // базі — готова страва; на такі рядки через аліас не ведемо.
    for (const a of item.aliases) {
      const n = normalizeName(a);
      const b = this.byNorm.get(n);
      if (b && !this.dishes.has(n)) return { base: b, rule: 'alias' };
    }
    // Оброблена форма (копчене, консерви, ікра, пюре, пиріг…) — не сирий рядок
    // бази: правила «голова + жирність» і «ключове слово» тут не вгадують.
    // Виняток — консервований тунець: у бази є власні рядки, і словник веде
    // на них першим; для решти маркерів вихід — estimate.
    const processed = (this.aliases.processed ?? []).some((w) => plain.includes(normalizeName(w)));
    if (processed) {
      const cats = new Set(item.categories.map(normalizeName));
      for (const k of this.aliases.keywords) {
        if (!/консерв|у власному соку|в олії/.test(k.base.toLowerCase())) continue;
        if (!cats.has(normalizeName(k.cat)) && !item.categories.some((c) => normalizeName(c).includes(normalizeName(k.cat)))) continue;
        if (k.kw.some((w) => wordIn(plain, normalizeName(w)))) return { base: k.base, rule: 'keyword' };
      }
      return null;
    }
    // 2. голова + жирність
    const pct = percentOf(plain);
    if (pct) {
      const headText = plain.slice(0, PCT.exec(plain)!.index).trim();
      const heads = Object.entries(this.aliases.heads)
        .filter(([, syn]) => syn.some((s) => headText === s || headText.startsWith(s + ' ') || s === headText.split(' ')[0]))
        .map(([h]) => h)
        .sort((a, z) => z.length - a.length);
      for (const head of heads) {
        const rows = this.headRows.filter((r) => r.head === head);
        if (!rows.length) continue;
        const inRange = rows.find((r) => pct.lo >= r.lo - 0.01 && pct.lo <= r.hi + 0.01);
        if (inRange) return { base: inRange.base, rule: 'head+percent' };
        const nearest = rows.map((r) => ({ r, d: Math.min(Math.abs(pct.lo - r.lo), Math.abs(pct.lo - r.hi)) })).sort((a, z) => a.d - z.d)[0]!;
        if (nearest.d <= 3) return { base: nearest.r.base, rule: 'head+percent' };
      }
      // жирність відома, але рядка з такою нема — не вгадуємо
      if (heads.length) return null;
    }
    // 3. категорія + ключове слово
    const cats = new Set(item.categories.map(normalizeName));
    for (const k of this.aliases.keywords) {
      if (!cats.has(normalizeName(k.cat)) && !item.categories.some((c) => normalizeName(c).includes(normalizeName(k.cat)))) continue;
      if (k.kw.some((w) => wordIn(plain, normalizeName(w)))) return { base: k.base, rule: 'keyword' };
    }
    return null;
  }
}
