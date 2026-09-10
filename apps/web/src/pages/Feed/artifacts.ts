// Вибір артефактів панелі з ходів сесії.
//
// Винесено з Feed.tsx окремим модулем не заради краси: логіка перестала
// бути однорядковою (три типи, «актуальний — останній», підрахунок рядків
// чека), а перевірити її на екрані можна лише тоді, коли в сесії випадково
// є потрібна картка. Тут вона перевіряється тестом на будь-яких даних.
import type { ChatCard } from '../../api';
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

/** Жива партія комори очима стрічки — рівно те, що вона тримає з /v1/pantry. */
export interface LiveBatch { label: string; value: number | null; unit: string | null }

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

// П6-Т3: партії, яких картка списання торкнулась і які лишились ЖИВІ.
//
// Списання буває двох родів, і різниця між ними — не відтінок. «Зʼїли все»
// (`deplete`) забирає партію цілком: показувати після нього нема чого, і
// стрілка вела б у порожнечу — саме тому слід списання досі був рядком
// тексту. «Зʼїли половину» (`correct` із залишком, а після готування ще й
// `open`) лишає партію в коморі з новим числом — і от її показати треба:
// це головне, що людина хоче перевірити відразу.
//
// Живою вважаємо ту, що є в мапі: стрічка кладе туди лише не-depleted
// партії. Ключ — `batch_id`, який сервер проставляє на застосуванні; назви
// тут недостатньо, бо однойменних партій буває дві.
export function survivingBatches(
  t: ArtifactTurn,
  live: Map<string, LiveBatch>,
): { id: string; label: string; value: number | null; unit: string | null }[] {
  if (!isWriteOff(t) || !t.applied || t.undone) return [];
  const out: { id: string; label: string; value: number | null; unit: string | null }[] = [];
  const seen = new Set<string>();
  for (const op of (t.card?.ops ?? []) as { batch_id?: string }[]) {
    const id = op.batch_id;
    if (!id || seen.has(id)) continue;
    const b = live.get(id);
    if (!b) continue;
    seen.add(id);
    out.push({ id, ...b });
  }
  return out;
}

// Позиції тієї самої картки, яких у живих уже немає, — повне списання.
// Вони лишаються рядком тексту без стрілки: відкривати нема чого.
export function goneLabels(t: ArtifactTurn, live: Map<string, LiveBatch>): string[] {
  if (!isWriteOff(t)) return [];
  return ((t.card?.ops ?? []) as { label?: string; batch_id?: string }[])
    .filter((o) => !o.batch_id || !live.has(o.batch_id))
    .map((o) => o.label)
    .filter((l): l is string => !!l);
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
  // П6-Т3: живі партії комори. Порожня мапа = «нічого не знаємо», і тоді
  // вкладок партій просто не буде — екран деградує до того, як було.
  live: Map<string, LiveBatch> = new Map(),
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
    } else if (isIntakeArtifact(t) && t.cardId && intakeAdds(t)) {
      out.push({
        key: t.cardId,
        kind: 'receipt',
        label: isReceiptSourced(t) ? 'Чек' : 'Комора',
        meta: String(receiptLines(t)),
        turn: t,
      });
    } else if (isIntakeArtifact(t)) {
      // П6-Т3: часткове списання. Артефакт тут — не картка, а ПАРТІЯ: та
      // сама `batch`, яку вже вміє панель (її відкриває Комора), просто досі
      // зі стрічки недосяжна. Нового виду артефакта не заводимо — проводимо
      // наявний.
      //
      // Одна партія — одна вкладка на всю сесію: два списання того самого
      // томата це не два документи, а один стан, і показує його жива комора,
      // а не знімок ходу.
      for (const b of survivingBatches(t, live)) {
        const key = `batch:${b.id}`;
        if (out.some((a) => a.key === key)) continue;
        out.push({ key, kind: 'batch', label: b.label, meta: '', turn: t });
      }
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
