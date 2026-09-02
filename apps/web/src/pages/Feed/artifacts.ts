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

// Артефактом стає чек — обох родів: і підтягнутий сервером із мережі, і
// показаний людиною в чаті. Спільне в них те, що й робить артефакт: довгий
// документ на десятки рядків, який не має гортатися разом із розмовою, і
// стабільний card_id, щоб правити один рядок, не перезбираючи картку.
//
// Будь-яка інша intake-картка артефактом НЕ стає: «поклав молоко в
// холодильник» — подія на два рядки; списання після готування — наслідок
// дії. Позначку ставить сервер за raw_kind моделі, а не ми тут за
// кількістю рядків: поріг «від N позицій — чек» був би числом зі стелі.
export function isReceipt(t: ArtifactTurn): boolean {
  if (t.card?.type !== 'intake_diff') return false;
  const kind = t.card.source?.kind;
  return kind === 'retail_receipt' || kind === 'chat_receipt';
}

// Скільки рядків у чеку разом: у комору + не для комори + не впізнав.
// Саме це число стоїть на вкладці («Чек 19») — воно про чек як документ,
// а не про те, скільки з нього поїде в комору.
export function receiptLines(t: ArtifactTurn | undefined): number {
  if (!t || !isReceipt(t)) return 0;
  const ops = t.card?.ops?.length ?? 0;
  const src = t.card?.source;
  // У чека з чату розкладки каталогу немає — модель повернула самі ops,
  // і всі рядки чека це вони. У чека мережі рядків більше, ніж поїде в
  // комору: nonfood і unmatched теж частина документа.
  if (src?.kind !== 'retail_receipt') return ops;
  return ops + src.nonfood.length + src.unmatched.length;
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
  const receipt = back.find((t) => isReceipt(t) && t.cardId);
  const out: Artifact<T>[] = [];
  if (cart) out.push({ key: 'cart', label: 'Кошик', meta: String(cart.card?.rows?.length ?? ''), turn: cart });
  if (recipe) out.push({ key: 'recipe', label: recipe.card?.title ?? 'Рецепт', meta: '', turn: recipe });
  if (receipt) out.push({ key: 'receipt', label: 'Чек', meta: String(receiptLines(receipt)), turn: receipt });
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
