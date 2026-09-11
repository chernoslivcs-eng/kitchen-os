// Рядок розмови й підпис дня — спільні для сайдбара/шухляди (G1). Меню
// розмов із пілюлі знято (FIXES-V3 №22, рішення власника): перемикач
// розмов один — сайдбар/шухляда; пілюля — лише назва розмови, тап відкриває
// те саме, що кнопка «панель» ліворуч. Це знімає й №20 (меню обрізалось).

export interface SessionRow {
  id: string;
  title: string;
  /** ISO-день сесії (YYYY-MM-DD). */
  day: string;
  created_at: string;
  /** Другий рядок: «чекає рішення» бурштином або «14:37» dim. */
  state?: { text: string; tone: 'amber' | 'dim' };
}

const WEEKDAY = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/** «Сьогодні» · «Вчора» · «Пн · 7 вер». */
export function dayLabel(day: string, today = new Date()): string {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (day === iso(today)) return 'Сьогодні';
  const y = new Date(today); y.setDate(y.getDate() - 1);
  if (day === iso(y)) return 'Вчора';
  const d = new Date(day + 'T00:00:00');
  const mon = d.toLocaleDateString('uk-UA', { month: 'short' }).replace('.', '');
  return `${WEEKDAY[d.getDay()]} · ${d.getDate()} ${mon}`;
}
