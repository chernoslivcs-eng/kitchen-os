// Розбір відповіді моделі: {reply, card} з сирого тексту.
//
// Живе в домені з тієї ж причини, що context.ts: цим користуються прод і eval.
// Поки парсер сидів у services/api, eval мав власний спрощений tryParse, який
// не знімав ```json-огорожі й не бачив другого обʼєкта — і через це давав
// вердикти по тексту, якого користувач ніколи не побачить.

import type { Card, Recipe } from './types.js';

/**
 * П4-Т5: один список типів замість двох, що розійшлись.
 *
 * Тут було ['…','recipe','cook_photo',…], а в services/api/src/model.ts —
 * своя копія з `recipe_edit` замість них. Недороблений переїзд: `extractJson`
 * уже жив у домені, а перевірку типу лишили на місці. Розійшовшись, копії
 * почали давати різні відповіді на те саме питання — і eval перевіряв не той
 * набір, що працює в проді.
 *
 * Склад — НЕ обʼєднання копій, а те, що промпт цього виклику дозволяє моделі
 * віддати. Обʼєднання розширило б набір, що доходить до людини.
 *
 * Виведено з `card-schemas.md` версії 2026-08-28 (він у складі виклику
 * `chat`): там документовано одинадцять типів. Вісім тут; трьох немає
 * свідомо:
 *
 *   `cook_go`, `cart_go`, `retail_search_go` — маркери ходу, не картки.
 *   Прибрати їх на користь поля `intent` — окреме рішення, і воно неможливе
 *   без правки промпту. До того часу вони й не ходять цією гілкою: модель
 *   віддає їх в обгортці {reply, card}, а обгортка типів не гейтить.
 *
 * `cook_photo` тут був зайвий за побудовою: його не віддає жодна модель —
 * сервер конструює його сам (services/api/src/routes/chat.ts).
 */
export const CHAT_CARD_TYPES: readonly string[] = [
  'intake_diff', 'proposal', 'shopping', 'profile',
  'recipe', 'recipe_edit', 'event', 'period',
];

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
  // Пріоритет: (1) обгортка {reply, card?, note?}; (2) обʼєкт із валідним type;
  // (3) перший знайдений. Тоді при двох JSON з type card вибирається один,
  // а другий не тече в reply. Обгортку впізнаємо за самим reply: крок 9 показав
  // відповідь {reply, note} без ключа card — вона не впізнавалась, і людині
  // йшла порожня репліка.
  const wrapper = found.find((o) =>
    o && typeof o === 'object' && 'reply' in (o as object),
  );
  // Список тут — тільки для розвʼязання нічиї між кількома JSON. Виклики, що
  // не про чат (розбір вкладення, генерація рецепта, alt-filter), віддають
  // обʼєкти БЕЗ поля `type` — для них ця гілка порожня й нічого не гейтить.
  const card = found.find((o) => {
    const t = (o as { type?: unknown } | null)?.type;
    return typeof t === 'string' && CHAT_CARD_TYPES.includes(t);
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
// Крок 8 (§7 контракту): необовʼязкове поле `note` — нотатка асистента.
// Парсер терпимий до відсутності: старі відповіді без поля — note: null.
export function noteFrom(o: Record<string, unknown>): string | null {
  return typeof o.note === 'string' && o.note.trim() ? o.note.trim() : null;
}

export function parseModelResponse(text: string): { reply: string; card: Card | null; note: string | null } {
  const { parsed, residualText } = extractJson(text);
  let reply = residualText;
  let card: Card | null = null;
  let note: string | null = null;
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    if ('reply' in o) {
      reply = typeof o.reply === 'string' ? o.reply : residualText;
      card = (o.card ?? null) as Card | null;
      note = noteFrom(o);
    } else if (typeof o.type === 'string' && CHAT_CARD_TYPES.includes(o.type)) {
      card = o as unknown as Card;
    }
  }
  return { reply, card, note };
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
  let parsed = extractJson(text).parsed as {
    kind?: AttachmentSubject; note?: string; ops?: unknown; recipe?: unknown;
  } | null;
  // Живий прогін 2026-08-31: модель віддала [{...}] — одноелементний масив
  // замість обʼєкта. Розгортаємо, а не валимо весь чек.
  if (Array.isArray(parsed) && parsed.length === 1 && parsed[0] && typeof parsed[0] === 'object') {
    parsed = parsed[0] as typeof parsed;
  }

  let card: Card | null = null;
  let raw_kind: AttachmentSubject | null = null;
  if (parsed?.kind === 'receipt' || parsed?.kind === 'shelf') {
    raw_kind = parsed.kind;
    // Схема моделі компактна (v/u/conf/ev) — приводимо до словника apply
    // (value/unit/confidence/evidence). Черга Д: без цього кількість із чека
    // мовчки губилась (apply читає тільки value/unit). Трійка product·brand·
    // variant і tags проходять наскрізь — їх споживає apply-тегер.
    if (Array.isArray(parsed.ops)) {
      const ops = (parsed.ops as Record<string, unknown>[]).map((o) => {
        const { v, u, conf, ev, ...rest } = o;
        return {
          ...rest,
          ...(rest.value === undefined && v !== undefined ? { value: v } : {}),
          ...(rest.unit === undefined && u !== undefined ? { unit: u } : {}),
          ...(rest.confidence === undefined && conf !== undefined ? { confidence: conf } : {}),
          ...(rest.evidence === undefined && ev !== undefined ? { evidence: ev } : {}),
        };
      });
      card = { type: 'intake_diff', ops: ops as never };
    }
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
