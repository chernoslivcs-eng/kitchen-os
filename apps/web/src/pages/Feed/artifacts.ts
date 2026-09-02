// Вибір артефактів панелі з ходів сесії.
//
// Винесено з Feed.tsx окремим модулем не заради краси: логіка перестала
// бути однорядковою (три типи, «актуальний — останній», підрахунок рядків
// чека), а перевірити її на екрані можна лише тоді, коли в сесії випадково
// є потрібна картка. Тут вона перевіряється тестом на будь-яких даних.
import type { ChatCard } from '../../api';

export type ArtifactKey = 'cart' | 'recipe' | 'receipt' | 'list';

export interface ArtifactTurn {
  id: string;
  cardId?: string | null;
  card?: ChatCard | null;
}

export interface Artifact<T extends ArtifactTurn> {
  key: ArtifactKey;
  label: string;
  meta: string;
  // Список — єдиний артефакт БЕЗ ходу: він не картка сесії, а стан дому,
  // що її переживає. Решта читаються з повідомлення, він — із живого
  // списку, тож ходу за ним немає й бути не може.
  turn: T | null;
}

// Скільки позицій робить intake-картку ДОКУМЕНТОМ, а не подією.
//
// Це число не зі стелі, і межу видно в самих даних продукту:
//   «поклав молоко в холодильник»           — 1-3 позиції
//   списання після готування                — стільки, скільки інгредієнтів
//                                             рецепта лежить у коморі, тобто
//                                             рідко більше восьми
//   чек, показаний або вставлений у чат     — 14-20 і більше
// Десять лягає в цей проміжок із запасом з обох боків.
//
// Спершу я вимагав сигналу від сервера (raw_kind моделі) і відмовлявся
// рахувати рядки. Це виявилось помилкою двічі: raw_kind існує ЛИШЕ на шляху
// розбору вкладення, а чек, вставлений текстом у поле вводу, його не має
// взагалі — і двадцять рядків гортались разом із розмовою. Довжина тут не
// евристика-замінник, а сама причина: артефакт існує рівно тому, що довгий
// документ не має гортатися разом із розмовою.
export const INTAKE_ARTIFACT_MIN = 10;

// Артефактом стає intake-картка, яка є ДОКУМЕНТОМ: чек будь-якого роду або
// будь-який довгий перелік. Спільне в них те, заради чого артефакт і
// існує: багато рядків, які не мають гортатися разом із розмовою, і
// стабільний card_id, щоб правити один рядок, не перезбираючи картку.
//
// Коротка intake-картка артефактом НЕ стає: «поклав молоко в холодильник»
// це подія, яку читають раз, і відкривати під неї вкладку означало б
// зробити панель журналом побутових дій.
export function isIntakeArtifact(t: ArtifactTurn): boolean {
  if (t.card?.type !== 'intake_diff') return false;
  const kind = t.card.source?.kind;
  if (kind === 'retail_receipt' || kind === 'chat_receipt') return true;
  return (t.card.ops?.length ?? 0) >= INTAKE_ARTIFACT_MIN;
}

// Чек називається чеком, решта — тим, чим є. «Це додав в комору: дрова,
// розпал…» не чек, і називати його так означало б вигадати за людину, що
// вона робила.
export function isReceiptSourced(t: ArtifactTurn): boolean {
  const kind = t.card?.source?.kind;
  return kind === 'retail_receipt' || kind === 'chat_receipt';
}

// Скільки рядків у документі разом — саме це число стоїть на вкладці.
// Воно про документ, а не про те, скільки з нього поїде в комору: людина
// принесла всі ці рядки, і всі вони в картці видимі.
export function receiptLines(t: ArtifactTurn | undefined): number {
  if (!t || !isIntakeArtifact(t)) return 0;
  const ops = t.card?.ops?.length ?? 0;
  // Відсічене вето каталогу — теж рядки документа.
  const vetoed = t.card?.nonfood?.length ?? 0;
  const src = t.card?.source;
  // У чека мережі рядків ще більше: там своя розкладка каталогу на три
  // кошики, і два з них у ops не потрапляють зовсім.
  if (src?.kind !== 'retail_receipt') return ops + vetoed;
  return ops + vetoed + src.nonfood.length + src.unmatched.length;
}

// Актуальний артефакт — ОСТАННІЙ свого роду. Кошик у Сільпо один за
// визначенням; рецепт заміщається наступним у тій самій вкладці; чек —
// той, який зараз розбирають. Попередні лишаються слідами у стрічці.
export function pickArtifacts<T extends ArtifactTurn>(
  turns: T[],
  // Кількість позицій списку, якщо його ВІДКРИЛИ. null — вкладки списку
  // немає: він «сам не з'являється й сам не тримається» (V4), інакше
  // кожна сесія починалася б із вкладки, якої ніхто не просив.
  listCount: number | null = null,
): Artifact<T>[] {
  const back = [...turns].reverse();
  const cart = back.find((t) => t.card?.type === 'cart' && t.cardId);
  const recipe = back.find((t) => t.card?.type === 'recipe_link');
  const intakeDoc = back.find((t) => isIntakeArtifact(t) && t.cardId);
  const out: Artifact<T>[] = [];
  if (cart) out.push({ key: 'cart', label: 'Кошик', meta: String(cart.card?.rows?.length ?? ''), turn: cart });
  if (recipe) out.push({ key: 'recipe', label: recipe.card?.title ?? 'Рецепт', meta: '', turn: recipe });
  if (intakeDoc) {
    out.push({
      key: 'receipt',
      label: isReceiptSourced(intakeDoc) ? 'Чек' : 'Комора',
      meta: String(receiptLines(intakeDoc)),
      turn: intakeDoc,
    });
  }
  if (listCount !== null) out.push({ key: 'list', label: 'Список', meta: String(listCount), turn: null });
  return out;
}

// Гліф артефакта — одна мова для вкладок і для згорнутої смуги. Раніше
// смуга малювала всім ◈ «якийсь артефакт», а вкладки писали назву; тепер
// і там, і там та сама позначка, і око не мусить перекладати.
// Словник узято з наявного в продукті: ✳ рецепти і ☰ список — ті самі,
// що в бічному меню.
export const ARTIFACT_GLYPH: Record<ArtifactKey, string> = {
  cart: '◈',
  recipe: '✳',
  receipt: '▤',
  list: '☰',
};
