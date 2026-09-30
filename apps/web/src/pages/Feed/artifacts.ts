// Вибір артефактів панелі з ходів сесії.
//
// Винесено з Feed.tsx окремим модулем не заради краси: логіка перестала
// бути однорядковою (три типи, «актуальний — останній», підрахунок рядків
// чека), а перевірити її на екрані можна лише тоді, коли в сесії випадково
// є потрібна картка. Тут вона перевіряється тестом на будь-яких даних.
import type { ChatCard } from '../../api';
import { dishIcon } from '../../lib/dish-icon';
import type { IconName } from '../../components/Icon/icons';
import { TRADITION_LABEL } from '../../lib/period';

// Крок Ф2: 'batch' — картка позиції комори в тій самій панелі.
export type ArtifactKey = 'cart' | 'recipe' | 'receipt' | 'list' | 'event' | 'batch';

export interface ArtifactTurn {
  id: string;
  cardId?: string | null;
  card?: ChatCard | null;
  // П6-Т3: слід списання питає не тільки «що в картці», а й «чи сталось це».
  // Незастосована й скасована картка партії не змінювали, тож і показувати
  // під ними живу позицію нема підстав.
  applied?: boolean;
  undone?: boolean;
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

// Списання. Той самий тип картки, що наповнення, але ops у ньому НЕ
// додають: deplete/correct/rename зменшують чи правлять те, що вже лежить.
//
// Рішення власника 28.09, скасовує 02.09: раніше списання не ставало
// артефактом (стрілка вела в порожнечу — слід малювався, вкладки не було,
// живий репро після карбонари), тож слід був рядком тексту. Після фіксу
// gone-рядків (PR #234: зʼїдене — рядок зі знаком «−», не хвіст) панель
// завжди має що показати, і причина ховати списання за текстом зникла —
// pickArtifacts тепер веде його в ту саму вкладку «Комора», що й наповнення.
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
// Межа тепер одна — тип картки, не її вміст: артефактом стає будь-яка
// intake_diff (наповнення, правка чи списання). До 28.09 списання (deplete/
// correct/rename без жодного add) сюди не потрапляло — панель відкривалась
// би порожньою, поки не було gone-рядків (PR #234). Тепер вони є завжди,
// і причина розрізняти зникла: pickArtifacts веде всі intake_diff в один
// артефакт, а «Комора»/«З комори» (label/трейс) кажуть, що саме сталось.
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
    } else if (type === 'period' && t.cardId) {
      // П2: період — серія (свята традиції, сезони, відписка) або один запис.
      const c = t.card!;
      const items = (c.items ?? []) as { title?: string }[];
      const series = c.kind === 'tradition' || !!c.unsubscribe;
      const label = series
        ? (c.unsubscribe && items.length === 1 ? items[0]?.title ?? 'Сезон' : c.tradition && c.set !== 'seasons' ? `${TRADITION_LABEL[c.tradition]} свята` : 'Сезони')
        : (c.title ?? 'Період');
      out.push({ key: t.cardId, kind: 'event', label, meta: series && !c.unsubscribe ? String(items.length) : '', turn: t });
    } else if (isIntakeArtifact(t) && t.cardId) {
      out.push({
        key: t.cardId,
        kind: 'receipt',
        // Уточнення власника 29.09: різниця додавання/списання має бути
        // очевидна — шапка панелі чистого списання зветься «Списано», не
        // «Комора» (наповнення й мішана картка лишаються «Комора»/«Чек»).
        label: isReceiptSourced(t) ? 'Чек' : isWriteOff(t) ? 'Списано' : 'Комора',
        meta: String(receiptLines(t)),
        turn: t,
      });
    }
  }
  if (listCount !== null) out.push({ key: 'list', kind: 'list', label: 'Список', meta: String(listCount), turn: null });
  return out;
}

/**
 * Знак артефакта. Був набором із шести заборонених гліфів (◈ ✳ ▤ ☰ ◷ ●) —
 * цілою підсистемою, яка пережила етапи 1.5 і 1.6, бо панель артефактів
 * відкривається лише коли артефакт є, а прогін аудиту туди не заходить
 * (DEBT §26).
 */
export const ARTIFACT_ICON = {
  cart: 'sys.cart',
  recipe: 'sys.recipes',
  receipt: 'sys.receipt',
  list: 'sys.list',
  event: 'sys.calendar',
  batch: 'sys.pantry',
} as const satisfies Record<ArtifactKey, string>;

/** Р1: рецепт — іконка страви за назвою (одна на рецепт скрізь); решта — знак виду артефакта. */
export function artifactIcon(a: { kind: ArtifactKey; label: string }): IconName {
  return a.kind === 'recipe' ? dishIcon(a.label) : ARTIFACT_ICON[a.kind];
}
