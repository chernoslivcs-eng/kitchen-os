// Пул-2 №5: захист від протікання нутрощів. Живий кейс 2026-08-31: інвентар
// на ~100 позицій упирався в max_tokens, JSON обривався, і юзер бачив
// `{ "reply": ..., "card": { ... "ops": [ , , ,` як текст репліки. Обірвану
// або нерозібрану модельну відповідь показувати не можна ніколи — тільки
// чесний фолбек.

export const INTAKE_TOO_BIG_REPLY =
  'Список завеликий — не подужав розібрати його цілком за раз. Кинь файлом-вкладенням або надішли частинами.';

// «Схоже на нутрощі»: починається як JSON/код-блок і містить службові ключі
// нашої схеми. Фігурні дужки в живому тексті ({0}-плейсхолдери) не ловимо.
export function looksLikeModelDebris(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const startsJsonish = /^[{[]/.test(t) || t.startsWith('```');
  if (!startsJsonish) return false;
  return /"(reply|card|ops|op|type|kind|label)"\s*:/.test(t);
}

// Пул-4 №4а: [HH:MM]-префікси історії протікали в reply (живий кейс:
// «[19:05] Тоді ризото підходить»). Формат службовий — у людському тексті
// час у квадратних дужках не пишуть, стрипаємо всі входження.
export function stripHistoryStamps(text: string): string {
  return text.replace(/\[\d{1,2}:\d{2}\]\s*/g, '').replace(/\s{2,}/g, ' ').trim();
}
