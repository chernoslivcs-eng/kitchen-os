// Вибір артефактів панелі з ходів сесії.
//
// Винесено з Feed.tsx окремим модулем не заради краси: логіка перестала
// бути однорядковою (три типи, «актуальний — останній», підрахунок рядків
// чека), а перевірити її на екрані можна лише тоді, коли в сесії випадково
// є потрібна картка. Тут вона перевіряється тестом на будь-яких даних.
import type { ChatCard } from '../../api';

export type ArtifactKey = 'cart' | 'recipe' | 'receipt';

export interface ArtifactTurn {
  id: string;
  cardId?: string | null;
  card?: ChatCard | null;
}

export interface Artifact<T extends ArtifactTurn> {
  key: ArtifactKey;
  label: string;
  meta: string;
  turn: T;
}

// Артефактом стає САМЕ чек мережі, а не будь-яка intake-картка: «поклав
// молоко в холодильник» — подія на два рядки, що застосовується одразу й
// нічого не чекає. Чек інший: тривалий стан із рішенням, і в нього
// стабільний card_id, тож правка одного рядка з чату не перезбирає картку.
export function isReceipt(t: ArtifactTurn): boolean {
  return t.card?.type === 'intake_diff' && t.card.source?.kind === 'retail_receipt';
}

// Скільки рядків у чеку разом: у комору + не для комори + не впізнав.
// Саме це число стоїть на вкладці («Чек 19») — воно про чек як документ,
// а не про те, скільки з нього поїде в комору.
export function receiptLines(t: ArtifactTurn | undefined): number {
  const src = t?.card?.source;
  if (!src || src.kind !== 'retail_receipt') return 0;
  return (t?.card?.ops?.length ?? 0) + src.nonfood.length + src.unmatched.length;
}

// Актуальний артефакт — ОСТАННІЙ свого роду. Кошик у Сільпо один за
// визначенням; рецепт заміщається наступним у тій самій вкладці; чек —
// той, який зараз розбирають. Попередні лишаються слідами у стрічці.
export function pickArtifacts<T extends ArtifactTurn>(turns: T[]): Artifact<T>[] {
  const back = [...turns].reverse();
  const cart = back.find((t) => t.card?.type === 'cart' && t.cardId);
  const recipe = back.find((t) => t.card?.type === 'recipe_link');
  const receipt = back.find((t) => isReceipt(t) && t.cardId);
  const out: Artifact<T>[] = [];
  if (cart) out.push({ key: 'cart', label: 'Кошик', meta: String(cart.card?.rows?.length ?? ''), turn: cart });
  if (recipe) out.push({ key: 'recipe', label: recipe.card?.title ?? 'Рецепт', meta: '', turn: recipe });
  if (receipt) out.push({ key: 'receipt', label: 'Чек', meta: String(receiptLines(receipt)), turn: receipt });
  return out;
}
