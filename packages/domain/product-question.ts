// Раунд 5, крок К1: чи репліка — питання про сам додаток.
//
// Блок [ПРО ДОДАТОК] (packages/prompts/versions/*/product-map.md) важить
// кілька тисяч токенів, і класти його в кожен хід — платити за карту екранів
// на «що на вечерю». Тому сервер підмішує його лише коли репліка схожа на
// питання про додаток. Класифікатор детермінований, без моделі, і свідомо
// грубий: хибне спрацювання — зайві токени, пропуск — модель відповідає
// як досі. Обидві помилки прийнятні; неприйнятна лише недетермінованість.
//
// Три умови разом:
//   1) питальне слово або дієслово дії («як», «де», «чому не», «чи можна»,
//      «налаштувати», «підключити», «видалити», «не працює», «не бачу»…);
//   2) слово зі словника продукту («додаток», «профіль», «комора», «список»,
//      «сільпо», «нотатк», «калорі», «кнопк»…);
//   3) жодної назви продукту з каталогу — щоб «як приготувати рибу» і
//      «де купити кінзу» не спрацювали.

import { CATALOG } from '@kitchen/catalog/seed';

// 1) Питальні слова й дієслова дії. Токени звіряються за початком слова.
const QUESTION_STEMS = [
  'як', 'де', 'куди', 'звідки', 'навіщо', 'чому',
  'налаштув', 'підключ', 'відключ', 'видал', 'змін', 'додат', 'додай', 'прибр',
  'запрос', 'відсканув', 'сканув', 'увійти', 'ввійти', 'вийти', 'зберег',
];
// Сполучення з часткою «не» / «чи» — регулярками, бо це два слова.
const QUESTION_PHRASES = [
  /(?<!\p{L})чому\s+(ти\s+|він\s+|воно\s+)?не(?!\p{L})/u,
  /(?<!\p{L})чи\s+(можна|є|буде|вміє|вмієш)(?!\p{L})/u,
  /(?<!\p{L})не\s+(працю|бачу|відкрива|можу|виходить|зберіга|підключа|знаход)/u,
  /(?<!\p{L})що\s+таке(?!\p{L})/u,
];

// 2) Словник продукту — початки слів. Не додавати «про всяк випадок»:
// кожне слово тут — привід дописати карту в промпт.
const PRODUCT_STEMS = [
  'додат', 'додатк', 'застосун', 'профіл', 'комор', 'списк', 'список', 'календар',
  'рецепт', 'стрічк', 'чек', 'сільпо', 'silpo', 'нотатк', 'тариф', 'акаунт',
  'фільтр', 'сортув', 'калорі', 'вхід', 'лінк', 'посиланн', 'кнопк', 'сторінк',
  'штрих', 'скан', 'журнал', 'кошик', 'мереж', 'дім', 'дому', 'домі', 'домашн',
  'пошт', 'google', 'гугл', 'картк', 'екран', 'таб', 'вкладк', 'пошук', 'зон',
  'свіжіст', 'іконк', 'бета', 'видал', 'бжв', 'білк', 'жир', 'вуглевод',
  'поділит', 'розмов', 'історі', 'мобільн', 'телефон', 'пароль', 'парол',
];

// Слова, які збігаються зі словниками вище, у каталозі не шукаємо:
// «список», «чек», «профіль» — не продукти, навіть якщо в каталозі є
// «чеддер» чи «профітролі».
const SKIP_IN_CATALOG = new Set([...QUESTION_STEMS, ...PRODUCT_STEMS]);

const STOP = new Set([
  'що', 'це', 'ти', 'він', 'вона', 'воно', 'вони', 'мені', 'мене', 'тобі', 'нам',
  'для', 'без', 'при', 'про', 'над', 'під', 'між', 'через', 'щоб', 'або', 'але',
  'так', 'ні', 'не', 'чи', 'вже', 'ще', 'там', 'тут', 'сам', 'сама', 'саме',
  'мій', 'моя', 'моє', 'мої', 'свій', 'своя', 'своє', 'свої', 'той', 'цей', 'ця',
  'усі', 'всі', 'все', 'усе', 'був', 'була', 'було', 'бути', 'має', 'маю',
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[ʼ'’ʹ`]/g, '')
    .split(/[^\p{L}\p{N}-]+/u)
    .filter(Boolean);
}

function stem(w: string): string {
  if (w.length <= 3) return w;
  if (w.length <= 5) return w.slice(0, -1);
  return w.slice(0, -2);
}

// Голови назв і аліасів каталогу — іменники-продукти («стейк», «картопля»),
// без модифікаторів і брендів («рібай», «нова», «ферма»). Стем-порівняння
// в обидва боки, мінімум 3 літери: «рибу» ↔ «риба», «помідори» ↔ «помідор».
const CATALOG_HEADS: Set<string> = (() => {
  const out = new Set<string>();
  for (const item of CATALOG) {
    for (const label of [item.name, ...item.aliases]) {
      const ws = tokens(label);
      const head = ws.find((w) => /[а-яіїєґ]/.test(w)) ?? ws[0];
      if (!head || head.length < 3) continue;
      if (STOP.has(head)) continue;
      out.add(stem(head));
    }
  }
  return out;
})();

function matchesStem(word: string, stems: readonly string[]): boolean {
  return stems.some((s) => word.startsWith(s));
}

function isCatalogWord(word: string): boolean {
  if (word.length < 3) return false;
  const s = stem(word);
  if (CATALOG_HEADS.has(s)) return true;
  // «помідори» → «помідо» проти «помід» з каталогу: коротший стем — префікс довшого.
  for (const h of CATALOG_HEADS) {
    if (h.length >= 4 && s.length >= 4 && (s.startsWith(h) || h.startsWith(s))) return true;
  }
  return false;
}

// К1а: «чому (ти) не пропонуєш / радиш / даєш / береш / готуєш …» — питання
// про поведінку асистента, а не про їжу, навіть коли далі стоїть назва
// продукту («чому ти не пропонуєш мʼясо?»). Гейт каталогу тут не діє.
const BEHAVIOUR_QUESTION = /(?<!\p{L})чому\s+(ти\s+)?не\s+(пропону|рад|да|бер|готу)(єш|иш|ю)?(?!\p{L})/u;

export function isProductQuestion(text: string): boolean {
  const t = text.toLowerCase();
  const ws = tokens(text);
  if (!ws.length) return false;
  if (BEHAVIOUR_QUESTION.test(t)) return true;

  const asks = ws.some((w) => matchesStem(w, QUESTION_STEMS)) || QUESTION_PHRASES.some((re) => re.test(t));
  if (!asks) return false;

  const aboutProduct = ws.some((w) => matchesStem(w, PRODUCT_STEMS));
  if (!aboutProduct) return false;

  const catalogHit = ws.some((w) => !STOP.has(w) && !matchesStem(w, [...SKIP_IN_CATALOG]) && isCatalogWord(w));
  return !catalogHit;
}

/** Блок [ПРО ДОДАТОК] для цього ходу — або null, якщо репліка не про додаток чи карти нема. */
export function productMapFor(text: string, map: string | undefined | null): string | null {
  if (!map) return null;
  return isProductQuestion(text) ? map.trim() : null;
}
