// Вибір артефактів панелі з ходів сесії.
//
// Винесено з Feed.tsx окремим модулем не заради краси: логіка перестала
// бути однорядковою (три типи, «актуальний — останній», підрахунок рядків
// чека), а перевірити її на екрані можна лише тоді, коли в сесії випадково
// є потрібна картка. Тут вона перевіряється тестом на будь-яких даних.
import type { ChatCard } from '../../api';

export type ArtifactKey = 'cart' | 'recipe' | 'receipt' | 'list' | 'event';

export interface ArtifactTurn {
  id: string;
  cardId?: string | null;
  card?: ChatCard | null;
}

export interface Artifact<T extends ArtifactTurn> {
  // Ключ — це КАРТКА, а не рід. Три рецепти в сесії це три артефакти, два
  // чеки — два. Заміщення «наступний рецепт займає ту саму вкладку» знято:
  // воно робило старий слід у стрічці брехливим — він відкривав новіший
  // документ, а не свій власний.
  key: string;
  // Рід дає іконку й назву, більше нічого.
  kind: ArtifactKey;
  label: string;
  meta: string;
  // Список — єдиний артефакт БЕЗ ходу: він не картка сесії, а стан дому,
  // що її переживає. Решта читаються з повідомлення, він — із живого
  // списку, тож ходу за ним немає й бути не може.
  turn: T | null;
}

// Артефактом стає intake-картка, яка є ДОКУМЕНТОМ: чек будь-якого роду або
// будь-який довгий перелік. Спільне в них те, заради чого артефакт і
// існує: багато рядків, які не мають гортатися разом із розмовою, і
// стабільний card_id, щоб правити один рядок, не перезбираючи картку.
//
// Коротка intake-картка артефактом НЕ стає: «поклав молоко в холодильник»
// це подія, яку читають раз, і відкривати під неї вкладку означало б
// зробити панель журналом побутових дій.
export function isIntakeArtifact(t: ArtifactTurn): boolean {
  return t.card?.type === 'intake_diff';
}

// Списання після готування. Той самий тип картки, що наповнення, але ops у
// ньому НЕ додають: deplete/correct зменшують те, що вже лежить.
//
// Різниця не косметична. Наповнення — це РІЧ, яка лишається жити: її
// відкривають артефактом, до неї повертаються. Списання — ПОДІЯ: сталась і
// минула, редагувати в ній нема чого. Тому воно не стає артефактом (див.
// intakeAdds у pickArtifacts) — а слід у стрічці все одно малювався пігулкою
// з стрілкою «→», яка вела в порожнечу. Живий репро 02.09: після карбонари
// «4 у комору →» не натискалось нічим.
export function isWriteOff(t: ArtifactTurn): boolean {
  if (t.card?.type !== 'intake_diff') return false;
  const ops = (t.card.ops ?? []) as { op?: string }[];
  return ops.length > 0 && !ops.some((o) => o.op === 'add');
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

// Артефакт — це КАРТКА, і набір належить сесії.
//
// Рішення Пилипа (02.09): «Новий рецепт — це ще один рецепт. А "ти
// неправильно розібрав чек" — це робота з поточним чеком». Тобто вибір між
// «створити новий» і «правити наявний» робиться ВИЩЕ — тим, чи народжується
// нова картка. Панель просто показує те, що є, і нічого не заміщає.
//
// Звідси й межа: артефактом стає картка, яка щось ДОДАЄ. Правка (rename,
// correct) і списання після готування (deplete) — не документи, а дії над
// уже наявним; вони лишаються карткою у стрічці й вкладки не відкривають.
// Порогів за кількістю рядків більше немає: «три банана» це такий самий
// документ, як чек на двадцять, просто коротший.
function intakeAdds(t: ArtifactTurn): boolean {
  const ops = (t.card?.ops ?? []) as { op?: string }[];
  return ops.some((o) => o.op === 'add');
}

export function pickArtifacts<T extends ArtifactTurn>(
  turns: T[],
  // Кількість позицій списку, якщо його ВІДКРИЛИ. null — вкладки немає:
  // список «сам не з'являється й сам не тримається» (V4).
  listCount: number | null = null,
): Artifact<T>[] {
  const out: Artifact<T>[] = [];
  for (const t of turns) {
    const type = t.card?.type;
    if (type === 'cart' && t.cardId) {
      out.push({ key: t.cardId, kind: 'cart', label: 'Кошик', meta: String(t.card?.rows?.length ?? ''), turn: t });
    } else if (type === 'recipe_link') {
      out.push({ key: t.cardId ?? t.id, kind: 'recipe', label: t.card?.title ?? 'Рецепт', meta: '', turn: t });
    } else if (type === 'event' && t.cardId) {
      // Подія — документ розмови, як рецепт: «намір на тиждень» лишається
      // поруч зі списком і правиться на місці (рішення 03.09).
      const first = (t.card?.ops as { title?: string }[] | undefined)?.find((o) => o.title);
      out.push({ key: t.cardId, kind: 'event', label: first?.title ?? 'Подія', meta: '', turn: t });
    } else if (isIntakeArtifact(t) && t.cardId && intakeAdds(t)) {
      out.push({
        key: t.cardId,
        kind: 'receipt',
        label: isReceiptSourced(t) ? 'Чек' : 'Комора',
        meta: String(receiptLines(t)),
        turn: t,
      });
    }
  }
  if (listCount !== null) out.push({ key: 'list', kind: 'list', label: 'Список', meta: String(listCount), turn: null });
  return out;
}

export const ARTIFACT_GLYPH: Record<ArtifactKey, string> = {
  cart: '◈',
  recipe: '✳',
  receipt: '▤',
  list: '☰',
  event: '◷',
};
