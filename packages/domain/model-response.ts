// Розбір відповіді моделі: {reply, card} з сирого тексту.
//
// Живе в домені з тієї ж причини, що context.ts: цим користуються прод і eval.
// Поки парсер сидів у services/api, eval мав власний спрощений tryParse, який
// не знімав ```json-огорожі й не бачив другого обʼєкта — і через це давав
// вердикти по тексту, якого користувач ніколи не побачить.

import type { Card, Recipe } from './types.js';

const CARD_TYPES = ['intake_diff', 'proposal', 'shopping', 'profile', 'recipe'];

// Витягає ВСІ верхньорівневі JSON-обʼєкти з тексту й обирає карту з валідним
// `type`. Модель іноді пише два обʼєкти в одну відповідь («ось intake для
// комори, ось proposal для рецепта») — раніше ми брали перший, а другий
// затікав у reply сирим JSON. QA-звіт зафіксував це як FIX-05.
export function extractJson(raw: string): { parsed: unknown; residualText: string } {
  // Знімаємо ```json-огорожу: sonnet любить її навіть коли просять чистий JSON.
  // Без цього беклапки лишались у reply й доходили до людини як текст.
  const text = raw.replace(/```(?:json)?\s*\n?/gi, '').replace(/```/g, '');
  const trimmed = text.trim();
  try {
    return { parsed: JSON.parse(trimmed), residualText: '' };
  } catch {}

  const found: unknown[] = [];
  let residual = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '{') { residual += text[i++]; continue; }
    const end = matchBrace(text, i);
    if (end === -1) { residual += text[i++]; continue; }
    const slice = text.slice(i, end + 1);
    try {
      found.push(JSON.parse(slice));
    } catch {
      residual += slice;
    }
    i = end + 1;
  }
  // Пріоритет: (1) обгортка {reply,card}; (2) обʼєкт із валідним type;
  // (3) перший знайдений. Тоді при двох JSON з type card вибирається один,
  // а другий не тече в reply.
  const wrapper = found.find((o) =>
    o && typeof o === 'object' && 'reply' in (o as object) && 'card' in (o as object),
  );
  const card = found.find((o) => {
    const t = (o as { type?: unknown } | null)?.type;
    return typeof t === 'string' && CARD_TYPES.includes(t);
  });
  return { parsed: wrapper ?? card ?? found[0] ?? null, residualText: residual.trim() };
}

// Індекс парної '}' для '{' на позиції start; -1 якщо не знайдено.
function matchBrace(text: string, start: number): number {
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

// Повний розбір відповіді: текст → {reply, card}. Та сама логіка, що в проді.
export function parseModelResponse(text: string): { reply: string; card: Card | null } {
  const { parsed, residualText } = extractJson(text);
  let reply = residualText;
  let card: Card | null = null;
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    if ('reply' in o && 'card' in o) {
      reply = typeof o.reply === 'string' ? o.reply : residualText;
      card = (o.card ?? null) as Card | null;
    } else if (typeof o.type === 'string' && CARD_TYPES.includes(o.type)) {
      card = o as unknown as Card;
    }
  }
  return { reply, card };
}

// Не плутати з AttachmentKind у types.ts — той про формат файлу (image|pdf|text),
// цей про те, що на ньому зображено.
export type AttachmentSubject = 'receipt' | 'shelf' | 'recipe' | 'dish' | 'other';

// Розбір відповіді на вкладення. Схема тут інша, ніж у чаті: не {reply, card},
// а {kind, note, ops|recipe}.
//
// Живе поруч із чатовим парсером із тієї ж причини, з якої сюди переїхав
// buildKitchenContext: цим користуються прод і eval. Поки логіка сиділа тільки
// в services/api, eval розбирав відповідь про чек ЧАТОВИМ парсером — той
// шукав {reply, card}, не знаходив, і віддавав порожню картку з JSON-уламком
// у полі reply. Тобто фікстури на чеки перевіряли не той конвеєр, що працює,
// і не могли позеленіти в принципі — що й було видно в снапшотах.
export function parseAttachmentResponse(text: string): {
  reply: string;
  card: Card | null;
  raw_kind: AttachmentSubject | null;
} {
  const parsed = extractJson(text).parsed as {
    kind?: AttachmentSubject; note?: string; ops?: unknown; recipe?: unknown;
  } | null;

  let card: Card | null = null;
  let raw_kind: AttachmentSubject | null = null;
  if (parsed?.kind === 'receipt' || parsed?.kind === 'shelf') {
    raw_kind = parsed.kind;
    // Схема моделі — attachment-parser.md; валідація полів робиться в apply.
    if (Array.isArray(parsed.ops)) card = { type: 'intake_diff', ops: parsed.ops as never };
  } else if (parsed?.kind === 'recipe') {
    raw_kind = 'recipe';
    const r = parsed.recipe as Recipe | undefined;
    // Без назви зберігати нічого: картка була б кнопкою в порожнечу.
    if (r?.t) card = { type: 'recipe', recipe: r };
  } else if (parsed?.kind) {
    // dish/other картки не дають: людина показала результат, не завдання.
    raw_kind = parsed.kind;
  }
  return { reply: parsed?.note ?? text, card, raw_kind };
}
