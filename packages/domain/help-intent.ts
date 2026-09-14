// UI-NOTES-0914 п. 7а: намір → довідка, детерміновано, без моделі, 0 $.
// Коротка репліка (≤ 8 слів), схожа на питання про додаток (isProductQuestion),
// з РІВНО ОДНІЄЮ темою з шести → id довідки. Дві теми, довга репліка або не
// питання → null, і хід іде в модель із картою продукту, як досі.
//
// Стеми свідомо вузькі: тут ціна помилки — не зайві токени, а ДОВІДКА ЗАМІСТЬ
// відповіді. «список» без «покупок/замовлення/сільпо/кошик» — теж тема list
// (кнопка «У список» — це саме він), але лише коли решта умов виконана.

import { isProductQuestion, hasCatalogWord } from './product-question.js';
import type { HelpTopicId } from './help-topics.js';

const MAX_WORDS = 8;
const STOP_WORDS = new Set(['що', 'це', 'ти', 'я', 'мені', 'а', 'і', 'й', 'та', 'чи', 'тут', 'у', 'в', 'з', 'із', 'за', 'про', 'для', 'ще', 'вже']);

const TOPIC_STEMS: Record<HelpTopicId, readonly string[]> = {
  telegram: ['телеграм', 'telegram', 'месендж', 'мессендж', 'месндж', 'меснж', 'бот'],
  start: ['почат', 'почн'],
  app: ['додат', 'додатк', 'застосун', 'вміє', 'вмієш'],
  list: ['списк', 'список', 'замовл', 'сільпо', 'silpo', 'кошик'],
  pantry: ['комор'],
  calendar: ['календар'],
};
// Для «з чого» / «що це» / «що ти вмієш» — фрази, а не стеми.
const TOPIC_PHRASES: Partial<Record<HelpTopicId, RegExp[]>> = {
  start: [/(?<!\p{L})з\s+чого(?!\p{L})/u],
  app: [/(?<!\p{L})що\s+(це|ти\s+вмієш|вмієш)(?!\p{L})/u],
};
// Відхилення від п. 7а (свідоме): isProductQuestion (К1) не бачить «з чого
// почати?», «як почати?», «що ти вмієш?», «що таке комора?» — у них нема стема
// продукту або «таке» ловить гейт каталогу. Спільний класифікатор не чіпаємо
// (ним живе карта продукту); ці явні форми довідкового питання проходять самі.
const HELP_QUESTION_FORMS = [
  /(?<!\p{L})з\s+чого\s+почати(?!\p{L})/u,
  /(?<!\p{L})як\s+почати(?!\p{L})/u,
  /(?<!\p{L})що\s+(ти\s+)?вмієш(?!\p{L})/u,
  /(?<!\p{L})що\s+таке(?!\p{L})/u,
];

function words(text: string): string[] {
  return text.toLowerCase().replace(/[ʼ'’ʹ`]/g, '').split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
}

export function helpTopicFor(text: string): HelpTopicId | null {
  const ws = words(text);
  if (!ws.length || ws.length > MAX_WORDS) return null;
  const t = text.toLowerCase();
  const byForm = HELP_QUESTION_FORMS.some((re) => re.test(t));
  if (!isProductQuestion(text) && !byForm) return null;
  // Слово-продукт у репліці — це не про додаток («як почати готувати борщ?»,
  // «що таке кімчі?»): модель. Самі слова форм («таке», «почати») і дієслово
  // «користуватись» гейт каталогу зачіпає хибно — їх перед перевіркою знімаємо.
  const rest = HELP_QUESTION_FORMS.reduce((acc, re) => acc.replace(re, ' '), t).replace(/(?<!\p{L})користува\p{L}*/gu, ' ');
  if (hasCatalogWord(rest)) return null;
  // Репліка, що пройшла ЛИШЕ за формою (не за К1), не має нести нічого, крім
  // теми: «як почати піст?» — це період, не довідка «З чого почати».
  if (!isProductQuestion(text)) {
    const extra = words(rest).filter((w) => !STOP_WORDS.has(w) && !(Object.values(TOPIC_STEMS).flat()).some((st) => w.startsWith(st)));
    if (extra.length) return null;
  }
  const hits = (Object.keys(TOPIC_STEMS) as HelpTopicId[]).filter((id) =>
    ws.some((w) => TOPIC_STEMS[id].some((s) => w.startsWith(s))) || (TOPIC_PHRASES[id] ?? []).some((re) => re.test(t)),
  );
  return hits.length === 1 ? hits[0]! : null;
}
