// Крок А4: один спосіб рахувати добу на всю адмінку.
//
// `dayBounds` жив усередині pulse.ts. Коли Зведення отримало періоди, спокуса
// була написати межі там ще раз — і саме так заводяться два способи рахувати
// добу, які розходяться через півроку на одну годину й нікому про це не
// кажуть. Тому межі переїхали сюди, а pulse.ts бере їх звідси.
//
// ЩО ТУТ ОЗНАЧАЄ «МІСЦЕВИЙ». Рядок `YYYY-MM-DD` тлумачиться в часовому поясі
// ПРОЦЕСУ (`new Date('2026-09-07T00:00:00')` без Z). На Vercel це UTC, на
// машині розробника — Europe/Kyiv. Тобто «місцевий» тут = «місцевий для
// сервера», і це вже було так до цього кроку.
//
// ВІДОМА МЕЖА, яку цей крок не закриває: клієнт рахує дату у СВОЄМУ поясі
// (Pulse.tsx, Money.tsx) і шле її рядком. На проді сервер тлумачить її як UTC,
// тож між київською північчю і UTC-північчю (00:00–03:00) вікно, яке просить
// клієнт, ще не почалось. Чесний ремонт — передавати пояс клієнта разом із
// датою; це окремий крок, і робити його всередині А4 означало б змінити
// семантику всім, хто вже читає ці межі.

export type Period = 'day' | 'week' | 'month';

/** Дата у форматі YYYY-MM-DD в поясі процесу. */
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** День у локальних межах: пульс читають по днях життя, не по UTC. */
export function dayBounds(day: string): { from: Date; to: Date } {
  const from = new Date(`${day}T00:00:00`);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

/**
 * Межі періоду, що ВМІЩУЄ вказаний день.
 *
 * Тиждень починається з понеділка — так живе тиждень тут, а не в неділю, як у
 * `getDay()`. Місяць — календарний, не «останні 30 днів»: власник порівнює
 * серпень із вереснем, а не ковзне вікно з ковзним вікном.
 */
export function periodBounds(period: Period, day: string): { from: Date; to: Date } {
  if (period === 'day') return dayBounds(day);

  const anchor = new Date(`${day}T00:00:00`);
  const from = new Date(anchor);
  const to = new Date(anchor);

  if (period === 'week') {
    // getDay(): 0 — неділя. Зсув до понеділка.
    const shift = (anchor.getDay() + 6) % 7;
    from.setDate(from.getDate() - shift);
    to.setTime(from.getTime());
    to.setDate(to.getDate() + 7);
    return { from, to };
  }

  from.setDate(1);
  to.setTime(from.getTime());
  to.setMonth(to.getMonth() + 1);
  return { from, to };
}

/**
 * Той самий період на крок назад. Для порівняння «$4.20, минулого тижня
 * $2.90» — саме воно, а не число, і каже, куди все йде.
 *
 * Для місяця це попередній КАЛЕНДАРНИЙ місяць, а не «мінус тридцять днів»:
 * інакше лютий порівнювався б із чимось, чого не існує.
 */
export function previousBounds(period: Period, day: string): { from: Date; to: Date } {
  const cur = periodBounds(period, day);
  const back = new Date(cur.from);
  if (period === 'day') back.setDate(back.getDate() - 1);
  else if (period === 'week') back.setDate(back.getDate() - 7);
  else back.setMonth(back.getMonth() - 1);
  return periodBounds(period, localDay(back));
}

/**
 * Скільки періоду вже минуло, часткою від 0 до 1. Прогноз множить на це.
 *
 * Нуль-захист свідомий: о 00:00:00 рівно частка нульова, і ділення на неї дало
 * б нескінченність замість числа. Мінімальна частка — година.
 */
export function elapsedShare(bounds: { from: Date; to: Date }, now: Date = new Date()): number {
  const span = bounds.to.getTime() - bounds.from.getTime();
  const gone = Math.min(span, Math.max(0, now.getTime() - bounds.from.getTime()));
  return Math.max(gone / span, 3600_000 / span);
}
