// Порожня розмова за Prototype (Р140): звертання на імʼя в кличному відмінку
// за правилами Prototype (renderVals.greeting) і питання за часом доби —
// «…, що на вечерю?» після 16:00, «…, що готуємо?» до. Без імені в профілі —
// без звертання, лише питання з великої літери.

/** Кличний відмінок за чотирма правилами Prototype; інше — як є. */
export function vocative(name: string): string {
  const n = name.trim();
  if (!n) return '';
  if (/я$/i.test(n)) return n.replace(/я$/i, 'ю');
  if (/а$/i.test(n)) return n.replace(/а$/i, 'о');
  if (/[ій]$/i.test(n)) return n.replace(/[ій]$/i, 'ю');
  if (/[бвгдзклмнпрстфхцчш]$/i.test(n)) return n + 'е';
  return n;
}

export const EVENING_FROM = 16;

export function greeting(name: string | null | undefined, now = new Date()): string {
  const evening = now.getHours() >= EVENING_FROM;
  const q = evening ? 'що на вечерю?' : 'що готуємо?';
  const voc = vocative(name ?? '');
  if (!voc) return q.charAt(0).toUpperCase() + q.slice(1);
  return `${voc}, ${q}`;
}
