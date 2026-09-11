// Хід стрічки — форма одного повідомлення в журналі і переклад із того, що
// віддає сервер (MessageInfo). Винесено з Feed.tsx окремим модулем: Feed —
// екран на 1700 рядків, а це чиста функція, яку треба вміти перевіряти
// без jsdom і без монтування половини продукту.

import type { ChatCard, MessageInfo } from '../../api';

export interface Turn {
  id: string;
  role: 'user' | 'assistant';
  time: string;
  text?: string;
  card?: ChatCard | null;
  cardId?: string | null;
  applied?: boolean;
  /** Етап 3: результат застосування — «9 із 14 · 5 пропущено» живе на ході, не в тості. */
  outcome?: import('./cards').ApplyOutcome;
  applying?: boolean;
  dismissed?: boolean;
  undoToken?: string;
  undone?: boolean;
  // UX9-02: відповідь не прийшла — хід позначений, під ним «↻ Повторити».
  failed?: boolean;
  // Моушн-кіт §02: щойно отримана відповідь з'являється «чанками по фразі».
  // Історичні ходи (F5, зміна сесії) — без цього, інакше стрічка мерехтить.
  fresh?: boolean;
  // Пул-7 №4: щойно застосована — картка спалахує шавлією 700ms.
  justApplied?: boolean;
  // M13 (канвас М6): «список щойно поповнився рецептом» — Кухня пропонує
  // зібрати кошик реплікою. Ephemeral: не персиститься на сервер, живе
  // тільки в цій сесії стрічки (як toast) — старий хід при F5 не воскресає.
  cartNudge?: boolean;
  cartNudgeBusy?: boolean;
  // Пул-9 №2: файли цього ходу. Раніше текст ходу підмінявся на «[вкладення]»,
  // а самі файли зникали — ні прев'ю, ні назви, відкрити неможливо.
  attachments?: TurnAttachment[];
  // Пул-9 №4: «Стоп» під час думання — хід лишається в стрічці з поміткою.
  aborted?: boolean;
  // Пул-9 №5: репліка стоїть у черзі — видима одразу, під нею «чекає».
  queued?: boolean;
}

// Пул-9 №2: мінімум, щоб намалювати мініатюру й відкрити файл. `kind` рахуємо
// з mime, `name` є тільки в щойно надісланих (сервер імена файлів не зберігає).
export interface TurnAttachment {
  id: string;
  kind?: 'image' | 'pdf' | 'text';
  name?: string;
}

export function attachmentKind(mime: string | null | undefined): 'image' | 'pdf' | 'text' {
  if (mime?.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return 'text';
}

export function hhmm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function messageToTurn(m: MessageInfo): Turn {
  const d = new Date(m.created_at);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const applied = m.applied > 0;
  return {
    id: newId(),
    role: m.role,
    time,
    text: m.text ?? undefined,
    card: m.card,
    cardId: m.card ? m.id : null,     // message.id === card_id за нашою інваріантою
    applied,
    // Аудит раунд 3, крок 1: undone_at/dismissed_at тепер їдуть з історії
    // (card_pending, приєднано на сервері) — досі скасовані/відхилені
    // auto-картки після F5 показувались як «ОЧІКУЄ», бо цих полів
    // просто не було в MessageInfo.
    undone: !!m.undone_at,
    dismissed: !!m.dismissed_at,
    // Пул-9 №2: вкладення переживають F5 — сервер віддає їх у MessageInfo,
    // прив'язаними до ходу через attachment.message_id.
    ...(m.attachments?.length
      ? { attachments: m.attachments.map((a) => ({ id: a.id, kind: attachmentKind(a.mime) })) }
      : {}),
    // undoToken на клієнті не відновлюємо — apply вже пройшов, повторний
    // apply/undo вимагатимуть нового токена. Кнопки undo після F5 нема.
  };
}

let nextId = 1;
export const newId = () => `t${nextId++}`;
