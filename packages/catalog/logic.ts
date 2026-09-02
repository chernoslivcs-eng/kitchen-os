// Логіка резолвера, алергенів, антипатернів і пошуку.
// Свідомо тримається на JS-структурі — тести перевіряють механіку, а не PostgreSQL.
// У проді ті самі правила стають SQL-запитами по catalog_ingredient + pg_trgm.

import { CATALOG, type CatalogItem } from './seed.js';

// ---------- нормалізація ----------

// Латиниця ↔ кирилиця тут не робимо (у прототипі це fold; для тестів достатньо lowercase).
// Головне: лапки, апострофи (ʼ / '/’), тире, крапки — прибрати.
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[ʼ'’ʹ`]/g, '')
    .replace(/[—–−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// Корінь без останніх двох літер, мінімум 4 символи.
// Це не морфологія, а її дешевий замінник (див. 01-product.html § M5).
export function root(word: string): string {
  const w = normalize(word);
  if (w.length <= 4) return w;
  return w.slice(0, Math.max(4, w.length - 2));
}

// Витяг «значимих» слів із фрази: викидаємо стоп-слова антипатерну.
// «не їм свинину й похідні» → ["свинину", "похідні"]
const STOPWORDS = new Set([
  'не', 'їм', 'є', 'пʼю', 'пю', 'люблю', 'хочу',
  'і', 'й', 'та', 'з', 'із', 'зі', 'на', 'у', 'в', 'до', 'від',
  'а', 'ані', 'жодного', 'жодної',
  'мене', 'мені',
  'алергія',
]);

export function meaningfulWords(phrase: string): string[] {
  return normalize(phrase)
    .split(/[\s,;.—\-]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

// ---------- алергени ----------

// Алергія «молюски» → знаходить усе, у чого allergen_groups або categories містять «молюски».
// Оце і є основне рішення каталогу. Без нього «молюски» не помічають «мʼясо мідій».
export function itemMatchesAllergen(item: CatalogItem, allergyLabel: string): boolean {
  const norm = normalize(allergyLabel);
  if (item.allergen_groups.some((g) => normalize(g) === norm)) return true;
  if (item.categories.some((c) => normalize(c) === norm)) return true;
  // Родові слова: «морепродукти» → категорія «морепродукти» на позиції каталогу
  if (item.categories.some((c) => normalize(c).includes(norm))) return true;
  return false;
}

// ---------- антипатерни ----------

// «не їм свинину» → root «свини» → категорії item, які починаються на «свини».
// «Ковбаса Міланська» має categories: ["ковбаса","сирокопчене","свинина","мʼясо","тваринне"].
// «свинина» починається на «свини» → збіг.
export function itemMatchesAntipattern(item: CatalogItem, phrase: string): boolean {
  const words = meaningfulWords(phrase);
  if (!words.length) return false;
  for (const w of words) {
    const r = root(w);
    for (const cat of item.categories) {
      if (normalize(cat).startsWith(r)) return true;
    }
    for (const alias of item.aliases) {
      if (normalize(alias).startsWith(r)) return true;
    }
    if (normalize(item.name).startsWith(r)) return true;
  }
  return false;
}

// ---------- сумісність категорій (фільтр альтернатив retail-пошуку) ----------

// 01.09: живий репро — пошук «Original Bitter Lemon» (безалкогольний тонік)
// у Сільпо повернув алкогольні бітери й косметику як «схожі» товари (наївний
// повнотекстовий пошук мережі не бачить категорій). Корені, де помилка НЕ
// прощається: якщо кандидат — алкоголь чи нехарчове, а оригінал — ні,
// категорично інший тип товару, показувати не можна.
const EXCLUSIVE_ROOTS = ['алкоголь', 'нехарчове'];

export function categoriesCompatible(sourceCategories: string[], candidateCategories: string[]): boolean {
  for (const r of EXCLUSIVE_ROOTS) {
    if (candidateCategories.includes(r) && !sourceCategories.includes(r)) return false;
  }
  return true;
}

// ---------- резолвер: партія комори → catalog_key ----------

// Три джерела зіставлення (див. 01-product.html § S1):
//   pantry   — посилання на партію (перевірка належності, без здогадок)
//   catalog  — канонічний ключ (точний збіг за нормалізованою назвою чи аліасом)
//   external — назва з кулінарного світу (евристика; тут — те саме alias-match зі score)
// priority — тай-брейкер за рівного score (див. CatalogItem.priority).
// Потрібен, бо на 2000+ позиціях той самий аліас іноді ведуть дві позиції
// («розмарин» — свіжий і сушений). За рівних score і priority виграє той, хто
// раніше в масиві, — тобто стартові 131 завжди попереду.
const prio = (item: CatalogItem): number => item.priority ?? 0;

// Рівень збігу. Раніше суворість була властивістю ФУНКЦІЇ: поблажливий
// resolveLabelToKey роздавав алергени, суворий resolveReceiptKey стеріг вето
// нехарчового — тобто вгадування стояло там, де помилка небезпечна, а
// прискіпливість там, де вона дешева. Тепер планку ставить той, хто питає:
// тільки він знає ціну помилки.
//   exact    — нормалізована назва збіглася цілком
//   anchored — усі слова аліаса стоять цілими словами І аліас несе ГОЛОВУ
//              мітки (або латинський бренд-токен, який ідентифікує товар)
//   words    — усі слова аліаса стоять цілими словами, голови немає
export type MatchTier = 'exact' | 'anchored' | 'words';
const TIER_RANK: Record<MatchTier, number> = { words: 1, anchored: 2, exact: 3 };

// Слова мітки. CamelCase НЕ розбиваємо навмисно: касовий рядок
// «Кр135БрусPontЧорОлив» справді не має меж слів, і вигадувати їх — значить
// повернути те саме вгадування. Мовчання на такому рядку чесніше за здогад;
// розгортати скорочення — робота моделі, каталог починається після неї.
function wordsOf(s: string): string[] {
  return normalize(s).split(/[^\p{L}\p{N}%]+/u).filter(Boolean);
}

// Голова — перше слово з кирилицею, а не буквально перше. METRO ставить
// бренд попереду («MC ПАРМІДЖАНО РЕДЖАНО», «KASEREI СИР КАМБОЦОЛА 70%»), і
// на «перше слово» правильні збіги гинули.
function headOf(ws: string[]): string | undefined {
  return ws.find((w) => /[а-яіїєґ]/.test(w)) ?? ws[0];
}

export function resolveLabel(
  label: string,
  minTier: MatchTier = 'anchored',
  catalog = CATALOG,
): { key: string; tier: MatchTier } | null {
  const norm = normalize(label);
  const ws = wordsOf(label);
  const set = new Set(ws);
  const head = headOf(ws);
  let best: { key: string; tier: MatchTier; score: number; priority: number } | null = null;
  for (const item of catalog) {
    for (const cand of [item.name, ...item.aliases]) {
      const c = normalize(cand);
      if (!c) continue;
      let tier: MatchTier | null = null;
      let weight = 0;
      if (c === norm) { tier = 'exact'; weight = c.length; }
      else {
        const cw = wordsOf(cand);
        // Кожне слово аліаса — цілим словом у мітці. Саме це вбиває цілий
        // рід підмін: «Сільпо» містить «сіль», «портерхаус» — «портер»,
        // «гель» — «ель», «картопляні» — «картопля», «кедрова» — «дрова».
        if (cw.length && cw.every((w) => set.has(w))) {
          const anchored = (head !== undefined && cw.includes(head))
            // Латинський бренд ідентифікує товар з будь-якої позиції.
            || cw.some((w) => /^[a-z0-9'’-]{4,}$/.test(w));
          tier = anchored ? 'anchored' : 'words';
          weight = cw.reduce((s, w) => s + w.length, 0);
        }
      }
      if (!tier || TIER_RANK[tier] < TIER_RANK[minTier]) continue;
      const score = TIER_RANK[tier] * 1000 + weight;
      if (!best || score > best.score || (score === best.score && prio(item) > best.priority)) {
        best = { key: item.key, tier, score, priority: prio(item) };
      }
    }
  }
  return best ? { key: best.key, tier: best.tier } : null;
}

// Планка за замовчуванням — `anchored`, бо найгарячіший споживач цієї
// функції (apply.ts) добирає нею АЛЕРГЕНИ в дірки тегів. Ціна хибного
// збігу там — чужий алерген на продукті, тож мовчання дешевше за здогад.
// Кому потрібна ширина (пошук, підказки, де людина дивиться очима) — кличе
// resolveLabel напряму з `words`.
export function resolveLabelToKey(label: string, catalog = CATALOG): string | null {
  return resolveLabel(label, 'anchored', catalog)?.key ?? null;
}

// Зона зберігання за назвою продукту. Використовується там, де зону не вказали
// явно — unpack списку покупок, intake_diff без zone. Без цього все падало в
// `dry`, і молоко переїжджало в комору замість холодильника (QA6-06).
export function resolveLabelToZone(label: string, catalog = CATALOG): CatalogItem['zone_default'] | null {
  const key = resolveLabelToKey(label, catalog);
  if (!key) return null;
  return catalog.find((c) => c.key === key)?.zone_default ?? null;
}

// ---------- пошук ----------

export interface SearchHit {
  item: CatalogItem;
  layer: 'exact' | 'alias' | 'substring' | 'root';
  score: number;
}

// Каскад із ранньою зупинкою (див. 01-product.html § S2).
// Тут спрощений: exact → alias → substring → root. Модель — окремо, тут її нема.
export function search(query: string, catalog = CATALOG): SearchHit[] {
  const q = normalize(query);
  if (!q) return [];
  const r = root(query);
  const hits: SearchHit[] = [];

  for (const item of catalog) {
    const name = normalize(item.name);
    const aliases = item.aliases.map(normalize);
    if (name === q) { hits.push({ item, layer: 'exact', score: 100 }); continue; }
    if (aliases.includes(q)) { hits.push({ item, layer: 'alias', score: 90 }); continue; }
    if (name.includes(q) || aliases.some((a) => a.includes(q))) {
      hits.push({ item, layer: 'substring', score: 70 });
      continue;
    }
    if (name.startsWith(r) || aliases.some((a) => a.startsWith(r))) {
      hits.push({ item, layer: 'root', score: 50 });
    }
  }
  // За рівного score вирішує priority; за рівного priority — порядок у масиві (sort стабільний).
  return hits.sort((a, b) => b.score - a.score || prio(b.item) - prio(a.item));
}
