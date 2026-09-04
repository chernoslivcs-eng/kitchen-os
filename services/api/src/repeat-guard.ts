// Повтор репліки після вже застосованої картки — детермінований хід, без моделі.
//
// Прод s41 (u11, 02.09; audit-materials/sessions): розбір двох чеків тривав
// 97 с, у стрічці не було жодного сигналу, людина надіслала «Оці чеки візьми»
// вдруге. Вкладень у повторі вже не було, репліка пішла текстовим chat,
// модель прочитала в історії штамп картки з 79 назвами і — попри мітку
// «[ЗАСТОСОВАНО — не додавай]» — зібрала з нього нову intake_diff на 58 ops.
// Половина комори реального користувача — дублі, створені продуктом.
//
// Захист стоїть ДО моделі, за зразком post-cook: якщо той самий текст уже
// прозвучав у цій сесії щойно, і відповідь на нього щось застосувала —
// відповідаємо самі. Нуль токенів, нуль нових партій. Той самий кейс — s40:
// «Не їм помідори і субпродукти» двічі за 12 секунд.
//
// Що НЕ вважається повтором: інший текст (навіть схожий); повтор через
// більше ніж REPEAT_WINDOW_MS (людина могла справді купити те саме ще раз);
// повтор після картки, яка нічого не застосувала (тоді хай модель спробує).

import type { MessageRow } from '@kitchen/domain';

export const REPEAT_WINDOW_MS = 15 * 60_000;

export interface RepeatHit {
  card_type: 'intake_diff' | 'shopping' | 'event' | 'profile';
  ops: number;
}

function norm(t: string): string {
  return t.toLowerCase().replace(/[\s\p{P}]+/gu, ' ').trim();
}

/**
 * Останній обмін «людина → асистент» у сесії: якщо текст людини збігається з
 * поточним, а картка асистента застосована — це повтор.
 */
export function detectRepeat(text: string, messages: MessageRow[], now = Date.now()): RepeatHit | null {
  const t = norm(text);
  if (!t) return null;
  // Останній хід людини й перша відповідь асистента після нього.
  let userIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') { userIdx = i; break; }
  }
  if (userIdx < 0) return null;
  const prev = messages[userIdx]!;
  if (norm(prev.text ?? '') !== t) return null;
  if (now - new Date(prev.created_at).getTime() > REPEAT_WINDOW_MS) return null;
  const answer = messages.slice(userIdx + 1).find((m) => m.role === 'assistant' && m.card);
  if (!answer || !answer.card || answer.applied <= 0) return null;
  const type = answer.card.type;
  if (type !== 'intake_diff' && type !== 'shopping' && type !== 'event' && type !== 'profile') return null;
  return { card_type: type, ops: answer.applied };
}

export function repeatReply(hit: RepeatHit): string {
  // «Скажи, скільки» має сенс лише там, де повтор МІГ БИ бути другою
  // покупкою/дією з кількістю (intake_diff, shopping). Подія й профіль —
  // не рахуються повторами: друга «не їм кінзу» не означає «два рази не їж».
  if (hit.card_type === 'event' || hit.card_type === 'profile') {
    return 'Побачив. Другий раз не записую — воно вже є.';
  }
  const n = hit.ops;
  const count = n === 1 ? 'Одного' : `Усіх ${n}`;
  return `Побачив. Другий раз не записую. ${count} нам поки вистачить. Якщо це справді друга покупка — скажи, скільки.`;
}
