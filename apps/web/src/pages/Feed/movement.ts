// Рішення власника 30.09 (спек docs/superpowers/specs/2026-09-30-pantry-movement-cards-design.md,
// §2а — уточнення 30.09 після звірки з кодом, коміт 7f142dfe):
// картка комори — запис ОДНОГО руху, який ніколи не переписується живим станом.
// Знак стоїть біля числа праворуч (не окремою колонкою ліворуч), одне правило
// на будь-яку зміну кількості — готування, чат, ручна правка однаково.
// before/value — серверний знімок PR #235 (змерджено 30.09): before — що було ДО
// цього op, value — що стало ПІСЛЯ (для add/correct) або відсутнє (deplete —
// «зʼїли все», в цього op узагалі нема поля кількості, apply.ts на бекенді
// відхиляє його як malformed, якщо модель таки спробує).
// used/remainder — PR #236 (сервер, ще не змерджено; форма підтверджена
// TELEGRAM BOT): готування з пачки дає ПАРУ ops — `correct`/`deplete` зі
// знятою кількістю (used) і `add` відкритого залишку (remainder: true).
// used, коли є, СИЛЬНІШЕ за різницю before−value (не «на додачу», а замість) —
// `before − value` на штучній партії лічив би «−1 шт» там, де людина взяла
// 250 г з пачки, а решта повернулась відкритою.
//
// Цей модуль — єдине джерело правди для (а) що показати праворуч рядка картки
// (cards.tsx) і (б) який агрегатний знак у картки для сліду й шапки панелі
// (artifacts.ts, Feed.tsx). Порахувати їх двічі різними формулами — це і є
// спосіб, яким слід і рядки колись розійшлись би знову.
import { formatQty } from '../../lib/units';
import { plural } from '../../lib/plural';

export interface MoveOp {
  op?: 'add' | 'deplete' | 'open' | 'rename' | 'correct';
  value?: number | null;
  unit?: string | null;
  qty?: number | null;
  pack?: { v?: number | null; u?: string | null } | null;
  /** Знімок «до» цього op — лише deplete/correct (PR #235). */
  before?: { value?: number | null; unit?: string | null } | null;
  /** correct: куди переїхала партія (§2а — рядок словом, коли кількість не мінялась). */
  zone?: string | null;
  /** correct: «сметана вже відкрита» — правка стану, а не подія відкриття. */
  state?: 'sealed' | 'opened' | null;
  /** correct/deplete після готування (PR #236): скільки САМЕ пішло в страву —
   *  сильніше за before−value, бо одиниці різні (partія рахує штуками, страва — грамами). */
  used?: { value?: number | null; unit?: string | null } | null;
  /** add відкритого залишку пачки (PR #236): не показуємо, не рахуємо в N. */
  remainder?: boolean | null;
}

export type RowSign = '+' | '−' | null;

/** §2: що йде праворуч рядка — знак приклеєний до числа, або слово без знака. */
export interface MovementText {
  sign: RowSign;
  /** Порожній рядок — рядок не показує право (rename: назва вже несе перехід). */
  text: string;
}

function qty(value: number, unit: string): string {
  return formatQty(value, unit);
}

/** §2а: слово переїзду в зону — той самий словник, що «до» використовує ZONE_LABELS
 *  у назві рядка (там — куди, називний відмінок для чипу; тут — рух, знахідний). */
const ZONE_MOVE_LABEL: Record<string, string> = {
  fresh: 'на стіл', fridge: 'у холодильник', freezer: 'у морозилку',
  dry: 'на полицю', spices: 'до спецій', drinks: 'до напоїв',
};

export function movementText(op: MoveOp): MovementText {
  if (op.op === 'open') return { sign: null, text: 'відкрито' };
  if (op.op === 'rename') return { sign: null, text: '' };

  if (op.op === 'add') {
    // §2а: кількість — value+unit АБО qty×pack. Одна упаковка не повторює
    // «1 ×» — «+400 г», не «+1 × 400 г»; кілька — «+4 × 400 г», не старий
    // формат «N шт · вага» (той плутав «штук» із «упаковок по»).
    if (op.qty != null && op.pack?.v != null && op.pack.u) {
      const packText = qty(op.pack.v, op.pack.u);
      return { sign: '+', text: op.qty === 1 ? `+${packText}` : `+${op.qty} × ${packText}` };
    }
    if (op.qty != null) return { sign: '+', text: `+${op.qty} шт` };
    if (op.value != null && op.unit) return { sign: '+', text: `+${qty(op.value, op.unit)}` };
    return { sign: '+', text: '+' };
  }

  if (op.op === 'deplete') {
    // PR #236: used — точно скільки пішло в страву (партії не вистачило —
    // used = уся партія, той самий результат, що й before, але одним правилом).
    const u = op.used;
    if (u?.value != null && u.unit) return { sign: '−', text: `−${qty(u.value, u.unit)}` };
    // deplete нічого, крім label/batch_id, не несе — списане = те, що БУЛО.
    const b = op.before;
    if (b?.value != null && b.unit) return { sign: '−', text: `−${qty(b.value, b.unit)}` };
    return { sign: '−', text: '−' };
  }

  if (op.op === 'correct') {
    // PR #236: used замінює різницю before−value, не доповнює — готування з
    // пачки дає correct{value:1,unit:'pcs'} (лишилось), used:{250,'g'} (пішло):
    // партія й страва рахують у різних одиницях, before−value тут «−1 шт»,
    // і це неправда.
    const u = op.used;
    if (u?.value != null && u.unit) return { sign: '−', text: `−${qty(u.value, u.unit)}` };
    // §2а: вага однієї одиниці партії (pack) — не кількість. «Кожна пачка
    // тепер 450 г» на партії з тим самим числом штук — «уточнено», без числа.
    if (op.pack) return { sign: null, text: 'уточнено' };
    // §2а: correct без value взагалі — це не кількість, а зона/стан/теги.
    if (op.value == null) {
      if (op.zone) return { sign: null, text: ZONE_MOVE_LABEL[op.zone] ?? 'уточнено' };
      if (op.state === 'opened') return { sign: null, text: 'відкрито' };
      return { sign: null, text: 'уточнено' };
    }
    const b = op.before;
    if (b?.value != null && b.unit && op.unit && b.unit === op.unit) {
      const diff = Math.round((op.value - b.value) * 100) / 100;
      if (diff < 0) return { sign: '−', text: `−${qty(-diff, op.unit)}` };
      if (diff > 0) return { sign: '+', text: `+${qty(diff, op.unit)}` };
      // Різниця 0 — правка нічого фактично не змінила: без знака, як і при
      // непорівнюваних одиницях нижче.
      return { sign: null, text: qty(op.value, op.unit) };
    }
    // Немає before (стара картка до PR #235) або одиниці не зводяться —
    // число як є, без вигаданого знака.
    if (op.unit) return { sign: null, text: qty(op.value, op.unit) };
    return { sign: null, text: '' };
  }

  return { sign: null, text: '' };
}

/**
 * §2а: пара «пачка + залишок» — рядок залишку (`add` із `remainder: true`)
 * картка не показує і в N не рахує; це половина ходу, не подія сама по собі.
 * Один предикат тут, а не inline-перевірка `op.op==='add' && op.remainder` у
 * кожному місці, що рахує рядки чи знак, — саме так рахунок і рендер колись
 * розійдуться знову. cards.tsx звертається до цього предиката напряму, коли
 * поруч із видимістю рядка потрібен і його індекс у справжньому ops (чекбокс,
 * off, onApply) — visibleOps індекс не тримає.
 */
export function isHiddenRemainder(op: MoveOp): boolean {
  return op.op === 'add' && !!op.remainder;
}

export function visibleOps<T extends MoveOp>(ops: T[]): T[] {
  return ops.filter((op) => !isHiddenRemainder(op));
}

/**
 * §3: агрегатний знак картки. Усі рядки «+» → додавання; усі «−» → списання;
 * інакше (мішане, без знака, порожньо) → просто «Комора» — стан, не напрям.
 * Рахує лише показані рядки (visibleOps) — залишок пачки в парі §2а мовчить.
 */
export function cardSign(ops: MoveOp[]): RowSign {
  const vis = visibleOps(ops);
  if (vis.length === 0) return null;
  const signs = vis.map((op) => movementText(op).sign);
  if (signs.every((s) => s === '+')) return '+';
  if (signs.every((s) => s === '−')) return '−';
  return null;
}

/** §3: назва сліду/шапки за агрегатним знаком (не для чека — той завжди «Чек»). */
export function movementLabel(sign: RowSign): string {
  return sign === '+' ? 'У комору' : sign === '−' ? 'Списано' : 'Комора';
}

/** §3: підрядок сліду за агрегатним знаком — «N у комору» / «N з комори» / «N змін». */
export function movementSubtitle(count: number, sign: RowSign): string {
  if (sign === '+') return `${count} у комору`;
  if (sign === '−') return `${count} з комори`;
  return `${count} ${plural(count, ['зміна', 'зміни', 'змін'])}`;
}
