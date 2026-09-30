// Рішення власника 30.09 (спек docs/superpowers/specs/2026-09-30-pantry-movement-cards-design.md):
// картка комори — запис ОДНОГО руху, який ніколи не переписується живим станом.
// Знак стоїть біля числа праворуч (не окремою колонкою ліворуч), одне правило
// на будь-яку зміну кількості — готування, чат, ручна правка однаково.
// before/value — серверний знімок PR #235: before — що було ДО цього op,
// value — що стало ПІСЛЯ (для add/correct) або відсутнє (deplete — «зʼїли все»,
// в цього op узагалі нема поля кількості, apply.ts на бекенді відхиляє його як
// malformed, якщо модель таки спробує).
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

export function movementText(op: MoveOp): MovementText {
  if (op.op === 'open') return { sign: null, text: 'відкрито' };
  if (op.op === 'rename') return { sign: null, text: '' };

  if (op.op === 'add') {
    if (op.qty != null) {
      const pack = op.pack?.v != null && op.pack.u ? ` · ${qty(op.pack.v, op.pack.u)}` : '';
      return { sign: '+', text: `+${op.qty} шт${pack}` };
    }
    if (op.value != null && op.unit) return { sign: '+', text: `+${qty(op.value, op.unit)}` };
    return { sign: '+', text: '+' };
  }

  if (op.op === 'deplete') {
    // deplete нічого, крім label/batch_id, не несе — списане = те, що БУЛО.
    const b = op.before;
    if (b?.value != null && b.unit) return { sign: '−', text: `−${qty(b.value, b.unit)}` };
    return { sign: '−', text: '−' };
  }

  if (op.op === 'correct') {
    const b = op.before;
    if (b?.value != null && b.unit && op.value != null && op.unit && b.unit === op.unit) {
      const diff = Math.round((op.value - b.value) * 100) / 100;
      if (diff < 0) return { sign: '−', text: `−${qty(-diff, op.unit)}` };
      if (diff > 0) return { sign: '+', text: `+${qty(diff, op.unit)}` };
      // Різниця 0 — правка нічого фактично не змінила: без знака, як і при
      // непорівнюваних одиницях нижче.
      return { sign: null, text: qty(op.value, op.unit) };
    }
    // Немає before (стара картка до PR #235), одиниці не зводяться, або
    // самого value нема — число як є, без вигаданого знака.
    if (op.value != null && op.unit) return { sign: null, text: qty(op.value, op.unit) };
    return { sign: null, text: '' };
  }

  return { sign: null, text: '' };
}

/**
 * §3: агрегатний знак картки. Усі рядки «+» → додавання; усі «−» → списання;
 * інакше (мішане, без знака, порожньо) → просто «Комора» — стан, не напрям.
 */
export function cardSign(ops: MoveOp[]): RowSign {
  if (ops.length === 0) return null;
  const signs = ops.map((op) => movementText(op).sign);
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
