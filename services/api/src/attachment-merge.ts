// Кілька вкладень — кілька викликів паралельно, одна відповідь.
//
// Прод s41: два чеки в одному виклику attachment_parse — 13 040 in / 8 629 out,
// 96,9 секунди, і жодного сигналу в стрічці весь цей час. Розбір по одному
// вкладенню на виклик і Promise.all ріже час до найдовшого з них (~40–50 с на
// чек), а не до суми; далі — прогрес у стрічці по мірі, це вже клієнт.
//
// Злиття: intake_diff — конкатенація ops; reply — одне речення про кількість
// плюс перша репліка моделі (вона вже в голосі); raw_kind — receipt, якщо хоч
// один чек; usage — сума. Різнорідні вкладення (чек + фото страви) не
// зливаються в один кошик — інтейк лишається, решта згадується в reply.

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
  const usage = calls.reduce(
    (acc, c) => ({
      input: acc.input + c.usage.input,
      output: acc.output + c.usage.output,
      cached: (acc.cached ?? 0) + (c.usage.cached ?? 0),
      cache_write: (acc.cache_write ?? 0) + (c.usage.cache_write ?? 0),
    }),
    { input: 0, output: 0, cached: 0, cache_write: 0 },
  );
  const first = calls.find((c) => c.reply)?.reply ?? '';
  const reply = ops.length
    ? `${calls.length} вкладення, разом ${ops.length} — ${first}`.trim()
    : first;
  return { reply, card, raw_kind, usage, meta: calls[0]!.meta };
}
