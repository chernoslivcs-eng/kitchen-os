// Кілька вкладень — кілька викликів паралельно, одна відповідь.
//
// Прод s41: два чеки в одному виклику attachment_parse — 13 040 in / 8 629 out,
// 96,9 секунди, і жодного сигналу в стрічці весь цей час. Розбір по одному
// вкладенню на виклик і Promise.all ріже час до найдовшого з них (~40–50 с на
// чек), а не до суми; далі — прогрес у стрічці по мірі, це вже клієнт.
//
// Злиття: intake_diff — конкатенація ops; reply — одне речення про кількість
// плюс перша репліка моделі (вона вже в голосі); raw_kind — receipt, якщо хоч
// один чек; облік — по одному запису на виклик. Різнорідні вкладення (чек +
// фото страви) не зливаються в один кошик — інтейк лишається, решта
// згадується в reply.

import type { Card } from '@kitchen/domain';
import type { AttachmentCall } from './model.js';

export function mergeAttachmentCalls(calls: AttachmentCall[]): AttachmentCall {
  if (calls.length === 1) return calls[0]!;
  const intake = calls.filter((c) => c.card?.type === 'intake_diff');
  const ops = intake.flatMap((c) => ((c.card as Extract<Card, { type: 'intake_diff' }>).ops ?? []));
  const card: Card | null = ops.length ? { type: 'intake_diff', ops } : (calls.find((c) => c.card)?.card ?? null);
  const kinds = calls.map((c) => c.raw_kind);
  const raw_kind = kinds.includes('receipt') ? 'receipt'
    : kinds.includes('shelf') ? 'shelf'
    : (kinds.find((k) => k) ?? null);
  // Крок А4б: usage НЕ складається. Два вкладення — це два виклики моделі й
  // два рядки в рахунку OpenRouter (звірка 08.09: 11:14, $0,0528 + $0,0790,
  // у нас один рядок $0,1319). Сума грошей від злиття не страждала, страждав
  // знаменник: «ціна одного виклику» виходила вдвічі більшою за справжню.
  const perCall = calls.flatMap((c) => c.calls);
  const first = calls.find((c) => c.reply)?.reply ?? '';
  // Ручний тест 04.09: «2 вкладення, разом 21 — Одинадцять позицій із Сільпо…»
  // — моя кількість зіткнулась із моделевою фразою про перший чек. Репліка
  // моделі описує ОДНЕ вкладення, тож у злитті вона не годиться; кажемо
  // лише про сукупність і даємо наступний крок, як велить attachment-parser.
  const reply = ops.length
    ? `Розібрав ${calls.length} вкладення — разом ${ops.length}. Розкласти?`
    : first;
  return { reply, card, raw_kind, calls: perCall, meta: calls[0]!.meta };
}
