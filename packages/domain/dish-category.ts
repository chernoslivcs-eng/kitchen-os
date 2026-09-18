// Р1 (spec 2026-09-18-recipe-card-design): категорія страви за НАЗВОЮ рецепта —
// скриптом, без моделі. Веб мапить категорію на ключ іконки (поки 6 гліфів +
// ковпак; нові гліфи доїдуть з дизайну без зміни цієї логіки).
//
// Правило пріоритету: назва страви важливіша за інгредієнт. «Паста з
// креветками» — pasta, не seafood; «Салат із бурратою» — salad, не veg. Тому
// словник іде двома ярусами: спершу шукаємо СТРАВУ (суп, салат, паста, тости…)
// за порядком слів — перше слово-страва виграє; лише коли жодного нема —
// інгредієнт (мʼясо, риба, овочі…), теж перший за порядком.
//
// Не впізнав → null (веб покаже ковпак cook.type).

export type DishCategory =
  | 'soup' | 'salad' | 'pasta' | 'dough' | 'sandwich' | 'breakfast' | 'dessert'
  | 'meat' | 'poultry' | 'fish' | 'seafood' | 'grain' | 'veg' | 'stew' | 'grill'
  | 'drink' | 'sauce' | 'pancake' | 'sushi' | 'burger';

export const DISH_CATEGORIES: readonly DishCategory[] = [
  'soup', 'salad', 'pasta', 'dough', 'sandwich', 'breakfast', 'dessert', 'meat', 'poultry', 'fish', 'seafood',
  'grain', 'veg', 'stew', 'grill', 'drink', 'sauce', 'pancake', 'sushi', 'burger',
];

/** Корінь → категорія. Корінь порівнюється з ПОЧАТКОМ слова (після нормалізації). */
type Rule = [DishCategory, string[]];

// Ярус 1 — назви страв (тип страви). Порядок усередині не важить: вирішує позиція в назві.
const DISH_RULES: Rule[] = [
  ['soup', ['суп', 'борщ', 'бульйон', 'консоме', 'шурп', 'юшк', 'крем-суп', 'солянк', 'розсольник', 'окрошк', 'гаспачо', 'рамен', 'фо ', 'харчо', 'soup', 'chowder', 'broth']],
  ['salad', ['салат', 'цезар', 'табуле', 'капрезе', 'salad', 'слоу']],
  ['pasta', ['паст', 'спагет', 'феттуч', 'фетуч', 'рісон', 'ризон', 'пенне', 'лінгвін', 'фарфалл', 'карбонар', 'путанеск', 'лазань', 'равіол', 'тортелін', 'ньок', 'тальятел', 'папардел', 'орзо', 'фузіл', 'макарон', 'локшин', 'pasta', 'spaghetti', 'fettuccine', 'penne', 'linguine', 'lasagn', 'gnocchi', 'tagliatelle']],
  ['dough', ['піц', 'кальцоне', 'фокач', 'хачапур', 'пиріг', 'пирог', 'пиріжк', 'кіш', 'галет', 'тарт', 'штрудел', 'вареник', 'пельмен', 'хінкал', 'мант', 'чебурек', 'pizza', 'focaccia', 'quiche']],
  ['sandwich', ['тост', 'сендвіч', 'сандвіч', 'бутерброд', 'брускет', 'кростін', 'панін', 'шаурм', 'шаварм', 'кесадил', 'врап', 'рол з', 'toast', 'sandwich', 'bruschetta', 'panini', 'wrap']],
  ['breakfast', ['омлет', 'яєчн', 'скрембл', 'шакшук', 'фрітат', 'яйц', 'яйце', 'гранол', 'вівсянк', 'каша вівсян', 'мюсл', 'omelet', 'omelette', 'shakshuka', 'frittata', 'granola']],
  ['dessert', ['десерт', 'торт', 'тістечк', 'печив', 'кекс', 'мафін', 'брауні', 'чізкейк', 'пудинг', 'мус', 'тірамісу', 'панакот', 'клафут', 'крамбл', 'морозив', 'сорбет', 'шоколад', 'цукерк', 'халв', 'запіканк', 'cake', 'cookie', 'brownie', 'cheesecake', 'pudding', 'tiramisu', 'crumble', 'clafouti']],
  ['pancake', ['панкейк', 'млинц', 'млинець', 'оладк', 'оладь', 'сирник', 'деруни', 'драник', 'вафл', 'pancake', 'crepe', 'waffle']],
  ['sushi', ['суші', 'рол', 'сашимі', 'нігірі', 'поке', 'sushi', 'sashimi', 'poke']],
  ['burger', ['бургер', 'чізбургер', 'burger']],
  ['stew', ['рагу', 'гуляш', 'жарк', 'тушков', 'соте', 'чилі', 'карі', 'кар\'ї', 'плов', 'ризото', 'різото', 'stew', 'goulash', 'curry', 'risotto', 'ragu']],
  ['grill', ['шашлик', 'гриль', 'барбекю', 'bbq', 'kebab', 'кебаб', 'на грилі']],
  ['drink', ['лімонад', 'смузі', 'коктейл', 'квас', 'компот', 'узвар', 'морс', 'чай', 'кава', 'какао', 'латте', 'капучин', 'глінтвейн', 'напій', 'сік', 'lemonade', 'smoothie', 'cocktail', 'latte']],
  ['sauce', ['соус', 'песто', 'дип', 'хумус', 'гуакамол', 'сальс', 'майонез', 'заправк', 'маринад', 'sauce', 'pesto', 'dip', 'hummus', 'guacamole', 'salsa']],
  ['grain', ['каш', 'кус-кус', 'кускус', 'булгур', 'кіноа', 'гречк', 'рис ', 'рис,', 'рис з', 'polenta', 'полент', 'porridge']],
];

// Ярус 2 — інгредієнти (коли назва страви не сказала, що це).
const INGREDIENT_RULES: Rule[] = [
  ['seafood', ['креветк', 'мідії', 'мідій', 'кальмар', 'восьминіг', 'краб', 'гребінц', 'морськ', 'устриц', 'лангуст', 'shrimp', 'prawn', 'mussel', 'squid', 'octopus', 'scallop', 'seafood']],
  ['fish', ['лосос', 'сьомг', 'тунц', 'тунець', 'дорадо', 'сибас', 'форел', 'скумбр', 'оселедц', 'тилап', 'тріск', 'хек', 'судак', 'короп', 'риб', 'палтус', 'salmon', 'tuna', 'trout', 'cod', 'fish', 'seabass', 'dorado']],
  ['poultry', ['курк', 'куряч', 'курч', 'індич', 'індик', 'качк', 'гус', 'крил', 'chicken', 'turkey', 'duck']],
  ['meat', ['стейк', 'філе', 'портерхаус', 'рибай', 'яловичин', 'ялович', 'свинин', 'свиняч', 'баранин', 'телятин', 'ковбас', 'бекон', 'фует', 'шинк', 'котлет', 'фрикадел', 'мʼяс', 'м\'яс', 'реберц', 'ребра', 'steak', 'beef', 'pork', 'lamb', 'ribs', 'bacon']],
  ['veg', ['овоч', 'цукін', 'кабач', 'баклажан', 'спарж', 'брокол', 'капуст', 'гарбуз', 'картопл', 'буряк', 'морков', 'шпинат', 'гриб', 'томат', 'помідор', 'перц', 'цибул', 'кукурудз', 'квасол', 'нут', 'сочевиц', 'vegetable', 'zucchini', 'eggplant', 'asparagus', 'mushroom', 'potato']],
];

/** Нормалізація: нижній регістр, апострофи до одного виду, дефіси/лапки — пробіли, зайві пробіли. */
export function normalizeDishTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[ʼ'’`]/g, '\'')
    .replace(/[«»"“”()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstHit(words: string[], norm: string, rules: Rule[]): { cat: DishCategory; pos: number } | null {
  let best: { cat: DishCategory; pos: number } | null = null;
  for (const [cat, roots] of rules) {
    for (const root of roots) {
      // Корені з пробілом — шукаємо в цілому рядку (позиція = індекс символу → слово).
      let pos = -1;
      if (/\s/.test(root)) {
        const i = (` ${norm} `).indexOf(root.startsWith(' ') ? root : ` ${root}`);
        if (i >= 0) pos = norm.slice(0, Math.max(0, i - 1)).split(' ').length - 1;
      } else {
        pos = words.findIndex((w) => w.startsWith(root));
      }
      if (pos >= 0 && (best === null || pos < best.pos)) best = { cat, pos };
    }
  }
  return best;
}

/** Прийменники, після яких іде гарнір/додаток: «портерхаус З панкейками» — панкейки не страва. */
const GARNISH_PREPS = new Set(['з', 'із', 'зі', 'під', 'на', 'в', 'у', 'до', 'для', 'with', 'on', 'in']);
/** «Стейк», «філе» — нарізка, не вид: «стейк тунця» — риба, «філе куряче» — птиця. */
const CUT_ROOTS = ['стейк', 'філе', 'рибай', 'steak', 'fillet'];

/** Категорія страви за назвою; null — не впізнав. */
export function dishCategory(title: string): DishCategory | null {
  const norm = normalizeDishTitle(title);
  if (!norm) return null;
  const words = norm.split(/[\s,;:/]+/).filter(Boolean).map((w) => w.replace(/^[^\p{L}]+|[^\p{L}%]+$/gu, ''));
  const dish = firstHit(words, norm, DISH_RULES);
  const ing = ingredientHit(words, norm);
  if (dish && ing) {
    // Інгредієнт на чолі назви, а слово-страва — після першого прийменника
    // («Портерхаус … з картопляними панкейками», «Тунець seared з салатом»):
    // страва тут гарнір, головне — інгредієнт. Інакше страва важливіша.
    const prep = words.findIndex((w) => GARNISH_PREPS.has(w));
    if (ing.pos === 0 && prep >= 0 && dish.pos > prep) return ing.cat;
    return dish.cat;
  }
  return dish?.cat ?? ing?.cat ?? null;
}

function ingredientHit(words: string[], norm: string): { cat: DishCategory; pos: number } | null {
  const hit = firstHit(words, norm, INGREDIENT_RULES);
  if (!hit) return null;
  // Нарізка (стейк/філе) без виду — дивимось, чия вона: «стейк тунця» → fish, «філе куряче» → poultry.
  const headIsCut = CUT_ROOTS.some((r) => words[hit.pos]?.startsWith(r));
  if (hit.cat === 'meat' && headIsCut) {
    const other = firstHit(words, norm, INGREDIENT_RULES.filter(([c]) => c === 'fish' || c === 'seafood' || c === 'poultry'));
    if (other) return { cat: other.cat, pos: hit.pos };
  }
  return hit;
}
