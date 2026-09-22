// Логіка резолвера, алергенів, антипатернів і пошуку.
// Свідомо тримається на JS-структурі — тести перевіряють механіку, а не PostgreSQL.
// У проді ті самі правила стають SQL-запитами по catalog_ingredient + pg_trgm.

import { CATALOG, type CatalogItem } from './seed.js';
export type { Nutrition, NutritionSource } from './nutrition.js';
// Етап 5: нутрієнти за назвою ПРОДУКТУ ДОМУ (не каталогу) — конкретніший
// рядок бази, коли він є. Деталі — runtime-base-match.ts.
export { matchProductNameToBaseRow } from './runtime-base-match.js';

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
//   generic  — навпаки: мітка ВУЖЧА за аліас («сир» проти «сир твердий»).
//              Родове слово знаходить видову позицію. Потрібне зоні
//              зберігання: «сметана», «риба», «стейк» окремими позиціями в
//              каталозі не стоять, а зона в усіх однакова, тож здогад тут
//              безпечний.
//   words    — усі слова аліаса стоять цілими словами, але голови немає.
//              НАЙНИЖЧИЙ рівень, і це не описка: саме тут модифікатор
//              перемагає голову («олія ЧАСНИК» → часник). Рівні не на одній
//              осі — generic про НАПРЯМОК вкладення, words про брак якоря, —
//              тож ладдер упорядкований за ЦІНОЮ помилки, не за широтою.
export type MatchTier = 'exact' | 'anchored' | 'generic' | 'words';
const TIER_RANK: Record<MatchTier, number> = { words: 1, generic: 2, anchored: 3, exact: 4 };

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

// Крок Ш3: передпідрахунок каталогу.
//
// resolveLabel на КОЖНОМУ виклику проходив усі позиції, а для кожного
// кандидата (назва + аліаси) рахував normalize(cand) і wordsOf(cand) заново —
// ~27 тисяч нормалізацій рядків на один виклик. Каталог при цьому незмінний.
// Заміряно на проді: один виклик 44 мс, а комора кличе його двічі на партію.
//
// Тут не змінюється жодне правило матчингу — тільки момент, коли рахуються ті
// самі значення. Правила матчингу це роки налагоджених винятків («Сільпо»
// містить «сіль», «кедрова» містить «дрова»), і чіпати їх у кроці про
// швидкість не можна.
interface PreparedCand {
  /** normalize(cand). Порожні кандидати в масив не потрапляють — як `if (!c) continue`. */
  norm: string;
  words: string[];
  wordsSet: Set<string>;
  /** cw.reduce((s, w) => s + w.length, 0) для гілки слів. */
  weight: number;
  /** cw.some((w) => /^[a-z0-9'’-]{4,}$/.test(w)) — властивість кандидата, не мітки. */
  latinBrand: boolean;
}
interface PreparedItem { item: CatalogItem; cands: PreparedCand[] }

// Ключ кешу — сам об'єкт каталогу: resolveLabel приймає catalog параметром, і
// тести передають свої набори. WeakMap, щоб тестовий каталог не жив вічно.
const PREPARED = new WeakMap<readonly CatalogItem[], PreparedItem[]>();

// Ліниво, при першому виклику, а не на імпорті: холодний старт лямбди й так
// дорогий, а seed.ts важить мегабайти.
function prepare(catalog: readonly CatalogItem[]): PreparedItem[] {
  const cached = PREPARED.get(catalog);
  if (cached) return cached;
  const out: PreparedItem[] = [];
  for (const item of catalog) {
    const cands: PreparedCand[] = [];
    // Порядок кандидатів той самий — [name, ...aliases]. Він значущий:
    // за рівних score і priority виграє той, хто раніше.
    for (const cand of [item.name, ...item.aliases]) {
      const norm = normalize(cand);
      if (!norm) continue;
      const words = wordsOf(cand);
      cands.push({
        norm,
        words,
        wordsSet: new Set(words),
        weight: words.reduce((s, w) => s + w.length, 0),
        latinBrand: words.some((w) => /^[a-z0-9'’-]{4,}$/.test(w)),
      });
    }
    out.push({ item, cands });
  }
  PREPARED.set(catalog, out);
  return out;
}

/** Контекст резолвера (15.09, PR 1 серії «строки»): зона з чека/форми. */
export interface ResolveCtx {
  zone?: CatalogItem['zone_default'];
}

// Широкі токени категорій, за якими «та сама група» не визначається:
// кефір і сир обидва «молочне», але «Сир Моцарела» не про кефір.
// Категорії, де м'яка планка вимагає виду, а не лише роду (етап 3, п.2).
const ALCOHOL_CATS_GENERIC = ['алкоголь', 'вино', 'пиво', 'лікер', 'ігристе', 'міцний алкоголь'];
const BROAD_TOKENS = new Set(['тваринне', 'рослинне', 'молочне', 'мʼясо', 'овочі', 'фрукти', 'консерви', 'напої', 'свіже', 'солодке', 'випічка', 'борошняне']);
// У зоні спецій свіжого не буває: овочі та зелень туди не резолвимо.
const NOT_IN_SPICES = new Set(['овочі', 'зелень', 'свіже', 'пасльонові']);

function sameGroup(a: CatalogItem, b: CatalogItem): boolean {
  const ta = a.categories.filter((c) => !BROAD_TOKENS.has(c));
  return ta.some((c) => b.categories.includes(c));
}

/** «орегано» у spices → «Орегано сушене», коли такий запис є (та сама голова назви: «Орегано свіже» / «Орегано сушене»). */
function driedVariant(item: CatalogItem, catalog: readonly CatalogItem[]): CatalogItem | null {
  if (!/fresh|свіж/i.test(item.key + ' ' + item.name)) return null;
  const head = wordsOf(item.name)[0];
  if (!head) return null;
  return catalog.find((i) => i.key !== item.key && wordsOf(i.name)[0] === head && /dried|сушен/i.test(i.key + ' ' + i.name)) ?? null;
}

/**
 * Етап 3 (CATALOG-KEY-AUDIT-0922.md): ВИД і СТАН, які слово в назві несе, а
 * резолвер не бачив. Усі п'ять підтверджених чужих ключів аудиту — одного типу:
 * рід збігся, уточнення проігноровано (темний шоколад → молочний, сухе желе →
 * готове, локшина швидкого приготування → домашня, вʼялені томати з сиром → в
 * олії, безалкогольне вино → звичайне зі спиртом).
 *
 * `refineSpecies` тут не допомагає: він працює лише над записами `gen_`, а всі
 * п'ять промахів — на конкретних позиціях (часто ще й притягнутих аліасом
 * бренда: «rioba шоколад» стоїть на молочному, «мрія желе» — на готовому).
 *
 * `strict: true` — мовчання обраної позиції вже є розбіжністю (начинка, вид
 * шоколаду, суха форма, безалкогольність: усе це змінює сам продукт).
 * `strict: false` — розбіжністю є лише ІНШЕ значення тієї ж осі (заливка: олія
 * проти розсолу змінює число, але не продукт, і мовчання каталогу тут
 * нормальне — інакше ми відкидали б half каталогу консервів).
 */
interface KindValue { value: string; re: RegExp }
interface KindAxis { axis: string; scope: RegExp; strict: boolean; values: KindValue[] }

const KIND_AXES: readonly KindAxis[] = [
  {
    axis: 'вид шоколаду', scope: /шоколад/, strict: true,
    values: [
      { value: 'чорний', re: /(^|[^а-яіїєґa-z])(темн[а-яіїє]*|чорн[а-яіїє]*|гірк[а-яіїє]*|екстрачорн[а-яіїє]*|dark)(?=$|[^а-яіїєґa-z])/ },
      { value: 'молочний', re: /(^|[^а-яіїєґa-z])(молочн[а-яіїє]*|milk)(?=$|[^а-яіїєґa-z])/ },
      { value: 'білий', re: /(^|[^а-яіїєґa-z])(біл[а-яіїє]*|white)(?=$|[^а-яіїєґa-z])/ },
    ],
  },
  {
    axis: 'суха форма', scope: /желе|кисіль/, strict: true,
    values: [
      // Голе «суміш» сюди не годиться: «Суміш лісових ягід заморожена» — теж
      // суміш, і сухе желе лягало на заморожені ягоди.
      { value: 'суха', re: /(^|[^а-яіїєґa-z])(сух[а-яіїє]*|порошок|концентрат)(?=$|[^а-яіїєґa-z])|суміш для/ },
      { value: 'готова', re: /(^|[^а-яіїєґa-z])(готов[а-яіїє]*)(?=$|[^а-яіїєґa-z])/ },
    ],
  },
  {
    axis: 'швидке приготування', scope: /локшин|вермішел/, strict: true,
    values: [
      { value: 'швидке', re: /(швидкого приготування|миттєвого приготування|instant|доширак|(^|[^а-яіїєґa-z])бп(?=$|[^а-яіїєґa-z]))/ },
    ],
  },
  {
    axis: 'начинка', scope: /./, strict: true,
    values: [
      // «Чипси зі смаком сиру» — та сама начинка іншими словами; без цього
      // «чипси Lay's з сиром» лишались без ключа (тест species-after-generic).
      { value: 'з сиром', re: /з сиром|зі смаком сиру|з сирною|сирн[а-яіїє]*|cheese|nadziewane/ },
      { value: 'з начинкою', re: /з начинкою|фарширован[а-яіїє]*/ },
    ],
  },
  {
    axis: 'безалкогольне', scope: /вино|пиво|ігристе|сидр|лікер|коктейл|шампанськ/, strict: true,
    values: [
      { value: 'без алкоголю', re: /безалкогольн[а-яіїє]*|(^|[^а-яіїєґa-z])б\/а(?=$|[^а-яіїєґa-z])|0[.,]0\s*%|alcohol[\s-]?free|non-alcoholic/ },
    ],
  },
  {
    axis: 'заливка', scope: /./, strict: false,
    values: [
      { value: 'в олії', re: /в олії|в оливковій олії|в соняшниковій олії/ },
      { value: 'у власному соку', re: /у власному соку|власному соку/ },
      { value: 'в розсолі', re: /в розсолі|у розсолі/ },
      { value: 'в томатному соусі', re: /в томатному соусі|у томатному соусі/ },
    ],
  },
];

const KIND_TEXT = new WeakMap<CatalogItem, string>();
function kindText(item: CatalogItem): string {
  let t = KIND_TEXT.get(item);
  if (t === undefined) { t = normalize([item.name, ...item.aliases].join(' ')); KIND_TEXT.set(item, t); }
  return t;
}
const valueIn = (axis: KindAxis, text: string): string | null => axis.values.find((v) => v.re.test(text))?.value ?? null;

/** Корені мітки поза самим маркером осі — ними шукаємо сусіда. */
function rootsOf(text: string): Set<string> {
  return new Set(text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3).map(root));
}

/**
 * Веде на позицію того самого роду з потрібним уточненням; якщо такої в
 * каталозі нема — повертає null, бо хибний ключ гірший за відсутній.
 */
export function refineKind(
  chosen: CatalogItem,
  normLabel: string,
  catalog: readonly CatalogItem[] = CATALOG,
): CatalogItem | null {
  let current = chosen;
  for (const axis of KIND_AXES) {
    if (!axis.scope.test(normLabel)) continue;
    const want = valueIn(axis, normLabel);
    if (!want) continue;
    const have = valueIn(axis, kindText(current));
    if (have === want) continue;
    if (!axis.strict && have === null) continue;
    const marker = axis.values.find((v) => v.value === want)!.re;
    const bare = normLabel.replace(marker, ' ');
    const labelRoots = rootsOf(bare);
    // Сусід мусить нести ГОЛОВУ мітки (без самого маркера): інакше «желе сухе
    // … зі смаком апельсина» бралось за «Сухарики зі смаком часнику» — вони
    // теж «сухі» й теж «зі смаком», і випадковий спільний корінь вирішував.
    const head = wordsOf(bare).find((w) => /[а-яіїєґ]/.test(w));
    const headRoot = head && head.length >= 3 ? root(head) : null;
    let sib: { item: CatalogItem; shared: number } | null = null;
    let tie = false;
    for (const { item } of prepare(catalog)) {
      if (item.key === current.key) continue;
      const text = kindText(item);
      if (valueIn(axis, text) !== want) continue;
      if (headRoot && ![...rootsOf(text)].some((r) => r.startsWith(headRoot) || headRoot.startsWith(r))) continue;
      // Префіксом, а не рівністю: root() ріже по два символи з кінця, тож
      // «яловичиною» дає «яловичин», а «яловичини» — «яловичи», і сусід із
      // потрібним смаком програвав випадковому по одному спільному слову.
      let shared = 0;
      for (const r of rootsOf(text.replace(marker, ' '))) {
        if ([...labelRoots].some((l) => l.startsWith(r) || r.startsWith(l))) shared++;
      }
      if (!shared) continue;
      if (!sib || shared > sib.shared) { sib = { item, shared }; tie = false; }
      else if (shared === sib.shared) tie = true;
    }
    // Нічия між двома однаково схожими сусідами — не монетка: мовчимо, і
    // resolveTripleKey спробує повну назву продукту, де слів більше.
    if (!sib || tie) return null;
    current = sib.item;
  }
  return current;
}

export function resolveLabel(
  label: string,
  minTier: MatchTier = 'anchored',
  catalog = CATALOG,
  ctx: ResolveCtx = {},
): { key: string; tier: MatchTier } | null {
  const norm = normalize(label);
  const ws = wordsOf(label);
  const set = new Set(ws);
  const head = headOf(ws);
  let best: { key: string; item: CatalogItem; tier: MatchTier; score: number; priority: number } | null = null;
  for (const { item, cands } of prepare(catalog)) {
    // (б) зона — контекст: у spices овочів і зелені не буває; свіжа трава там —
    // сушена, коли такий запис є (підміна нижче), інакше запис пропускаємо.
    if (ctx.zone === 'spices' && item.categories.some((c) => NOT_IN_SPICES.has(c)) && !driedVariant(item, catalog)) continue;
    for (const cand of cands) {
      const c = cand.norm;
      let tier: MatchTier | null = null;
      let weight = 0;
      if (c === norm) { tier = 'exact'; weight = c.length; }
      else {
        const cw = cand.words;
        // Кожне слово аліаса — цілим словом у мітці. Саме це вбиває цілий
        // рід підмін: «Сільпо» містить «сіль», «портерхаус» — «портер»,
        // «гель» — «ель», «картопляні» — «картопля», «кедрова» — «дрова».
        if (cw.length && cw.every((w) => set.has(w))) {
          const anchored = (head !== undefined && cw.includes(head))
            // Латинський бренд ідентифікує товар з будь-якої позиції.
            || cand.latinBrand;
          tier = anchored ? 'anchored' : 'words';
          weight = cand.weight;
        } else if (ws.length && ws.every((w) => cand.wordsSet.has(w))) {
          // Зворотний бік: мітка вужча за аліас. «сир» ⊂ «сир твердий».
          // Межі слова стережуть і тут — «дрова» не входить у слова аліаса
          // «олія кедрова», тому стара підміна не повертається.
          // Етап 3, п.2 (аудит): на алкоголі м'яка планка брала перший-ліпший
          // рядок роду — усі три лікери дому стали лімончело, бо в полі
          // `product` стоїть саме «лікер». Тут вид важить більше, ніж будь-де:
          // лікер від лікеру різниться лише смаком. Голий рід — мовчимо.
          if (ALCOHOL_CATS_GENERIC.some((c) => item.categories.includes(c))
            && !ws.some((w) => w !== head)) continue;
          tier = 'generic';
          // Вага НУЛЬОВА навмисно: усі родові збіги рівні, і вирішує
          // priority — тобто стартові 131 позиції, які і є щоденні
          // продукти дому. Спроба ранжувати довжиною аліаса давала
          // випадкового переможця: «масло» знаходило соняшникову олію
          // замість вершкового, «ковбаски» — сирокопчені замість свіжих,
          // і зона з'їжджала в dry.
          weight = 0;
        }
      }
      if (!tier || TIER_RANK[tier] < TIER_RANK[minTier]) continue;
      const score = TIER_RANK[tier] * 1000 + weight;
      if (!best || score > best.score || (score === best.score && prio(item) > best.priority)) {
        best = { key: item.key, item, tier, score, priority: prio(item) };
      }
    }
  }
  if (!best) return null;
  const refined = refineKind(refineSpecies(best.item, set, catalog, ctx), norm, catalog);
  if (!refined) return null;
  return { key: refineFrozen(refined, norm, catalog, ctx).key, tier: best.tier };
}

// Р161, PR 2: маркери заморозки в чековому рядку/мітці. «в/м» (варено-морожені)
// і «с/м» (свіжоморожені) — маркування Сільпо/METRO; «морозиво» — не маркер.
const FROZEN_MARKER = /(^|[\s(])(з\/м|с\/м|в\/м|зам\.|заморож[а-яіїє]*|морож[а-яіїє]*|frozen)(?=$|[\s).,;])/u;
export function hasFrozenMarker(label: string): boolean {
  return FROZEN_MARKER.test(normalize(label));
}

/**
 * Свіже і заморожене — один продукт, два життя (`frozen_of` у каталозі).
 * Заморожена пара береться ЛИШЕ за маркером у мітці або зоною freezer із
 * чека/форми; явна зона НЕ freezer повертає свіже. Без сигналу — як є:
 * «спливло раніше» дешевше, ніж «ще добре». Завжди-заморожене (пельмені,
 * морозиво — без `frozen_of`) зоною не «розморожується».
 */
export function refineFrozen(
  chosen: CatalogItem,
  normLabel: string,
  catalog: readonly CatalogItem[] = CATALOG,
  ctx: ResolveCtx = {},
): CatalogItem {
  const frozenSignal = ctx.zone === 'freezer' || FROZEN_MARKER.test(normLabel);
  if (frozenSignal) {
    if (chosen.frozen_of || chosen.zone_default === 'freezer') return chosen;
    return catalog.find((i) => i.frozen_of === chosen.key) ?? chosen;
  }
  if (ctx.zone && ctx.zone !== 'freezer' && chosen.frozen_of) {
    return catalog.find((i) => i.key === chosen.frozen_of) ?? chosen;
  }
  return chosen;
}

/**
 * Правила (а) і (б) над уже обраним записом. Окремо — бо чековий резолвер
 * (services/api, resolveReceiptKey) має власний цикл і мусить давати ТОЙ САМИЙ
 * ключ (тест «два резолвери на одному корпусі»).
 *
 * (а) Родова голова взяла загальний запис, а далі в мітці стоїть вид тієї ж
 *     групи («Сир Моцарела», «Хліб … житній») — вид перемагає, незалежно від
 *     порядку слів. Р161: досі «Сир Гауда 45%» давало «Сир» (твердий, 60 дн).
 *     Вид мусить нести слово ПОЗА родовим («Олія Олейна»: «олейна» — вид,
 *     саме «олія» — ні).
 * (б) У зоні спецій трава — сушена, коли такий запис є.
 */
export function refineSpecies(
  chosen: CatalogItem,
  labelWords: ReadonlySet<string>,
  catalog: readonly CatalogItem[] = CATALOG,
  ctx: ResolveCtx = {},
): CatalogItem {
  if (chosen.key.startsWith('gen_')) {
    const genWords = new Set(chosen.aliases.flatMap((a) => wordsOf(a)).concat(wordsOf(chosen.name)));
    let sp: { item: CatalogItem; weight: number } | null = null;
    for (const { item, cands } of prepare(catalog)) {
      if (item.key.startsWith('gen_') || !sameGroup(chosen, item)) continue;
      if (ctx.zone === 'spices' && item.categories.some((c) => NOT_IN_SPICES.has(c)) && !driedVariant(item, catalog)) continue;
      for (const cand of cands) {
        const cw = cand.words;
        if (!cw.length || !cw.every((w) => labelWords.has(w)) || !cw.some((w) => !genWords.has(w))) continue;
        if (!sp || cand.weight > sp.weight || (cand.weight === sp.weight && prio(item) > prio(sp.item))) sp = { item, weight: cand.weight };
      }
    }
    if (sp) chosen = sp.item;
  }
  if (ctx.zone === 'spices') chosen = driedVariant(chosen, catalog) ?? chosen;
  return chosen;
}

// Планка за замовчуванням — `anchored`, бо найгарячіший споживач цієї
// функції (apply.ts) добирає нею АЛЕРГЕНИ в дірки тегів. Ціна хибного
// збігу там — чужий алерген на продукті, тож мовчання дешевше за здогад.
// Кому потрібна ширина (пошук, підказки, де людина дивиться очима) — кличе
// resolveLabel напряму з `words`.
export function resolveLabelToKey(label: string, catalog = CATALOG, ctx?: ResolveCtx): string | null {
  return resolveLabel(label, 'anchored', catalog, ctx)?.key ?? null;
}

/**
 * Ключ продукту за ТРІЙКОЮ: спершу база (`product`), потім повна назва
 * (product + brand + variant). Вид завжди бʼє загальний запис: коли база дає
 * gen_* («вершки» → gen_cream), а повна назва — вид («вершки 33%» → cream_33),
 * береться вид. До GENERIC-0915 база на родовому слові мовчала й повна назва
 * бралась сама собою; загальні записи цю дірку закрили — і разом із нею
 * закрили шлях до виду (CI packages/db, decideKey: «вершки 33%» → gen_cream).
 */
export function resolveTripleKey(
  product: string,
  displayName: string,
  minTier: MatchTier = 'anchored',
  catalog = CATALOG,
  ctx?: ResolveCtx,
): string | null {
  const base = resolveLabel(product, minTier, catalog, ctx)?.key ?? null;
  if (base && !base.startsWith('gen_')) return base;
  const full = displayName && displayName !== product ? resolveLabel(displayName, minTier, catalog, ctx)?.key ?? null : null;
  if (full && !full.startsWith('gen_')) return full;
  return base ?? full;
}

// Зона зберігання за назвою продукту. Використовується там, де зону не вказали
// явно — unpack списку покупок, intake_diff без zone. Без цього все падало в
// `dry`, і молоко переїжджало в комору замість холодильника (QA6-06).
export function resolveLabelToZone(label: string, catalog = CATALOG): CatalogItem['zone_default'] | null {
  // Планка НИЖЧА, ніж у resolveLabelToKey, і це навмисно. Людина каже «купив
  // сир», «сметана», «стейк» — окремих позицій під ці родові слова в
  // каталозі немає, а зона в усіх сирів однакова. Ціна помилки тут — одна
  // правка зони; ціна мовчання — падіння в `dry`, тобто сметана в сухій
  // коморі (QA6-06, проти чого ця функція й писалась).
  const hit = resolveLabel(label, 'generic', catalog);
  if (!hit) return null;
  return catalog.find((c) => c.key === hit.key)?.zone_default ?? null;
}

// ---------- широта назви: продукт чи категорія? ----------

// «Купив мʼясо» — це не продукт, це категорія: під нею 560 позицій каталогу.
// «Камбоцола» — продукт. Різниця машинна, і рахує її каталог, а не модель.
//
// 02.09: спершу я взяв за ознаку `catalog_key === null` — мовляв, не впізнали,
// отже обмаль. Хибно: «свинина» і «яловичина» теж не мають позиції з такою
// назвою, хоч це цілком конкретні відповіді. Позначка трималась би вічно, і
// асистент перепитував би після кожної відповіді. Правильна ознака — саме
// категорійність: слово називає КЛАС, а не річ.
//
// Кількість позицій під категорією — міра широти, і вона дає порівнювати:
// «мʼясо» 560 → «свинина» 250 → «стейк» 20. Рішення, коли саме питати, тут
// НЕ ухвалюється: ця функція лише вимірює, а політику тримає той, хто питає.
const CATEGORY_SIZE: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (const item of CATALOG) {
    for (const c of item.categories) {
      const k = normalize(c);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
  return m;
})();

const ITEM_NAMES: Set<string> = new Set(
  CATALOG.flatMap((i) => [i.name, ...i.aliases]).map(normalize).filter(Boolean),
);

// Скільки позицій каталогу підпадає під цю назву, якщо вона — категорія.
// null, якщо назва не категорія АБО водночас є назвою конкретного товару
// («курка» — і категорія на 85 позицій, і «Курка ціла»; тоді це продукт).
export function categoryBreadth(label: string): number | null {
  const n = normalize(label);
  if (!n || ITEM_NAMES.has(n)) return null;
  return CATEGORY_SIZE.get(n) ?? null;
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
