// Лист як дані (спек EMAIL-SPEC-1003, погоджено власником 03.10).
//
// Доти лист був парою рядків `{ subject, text }`, і текст одразу містив
// розмітку абзаців. Тепер у нього є частини — заголовок, абзаци, кнопка,
// підпис — бо той самий лист малюється трьома способами: HTML для пошти,
// text/plain для неї ж (вимога спека) і просте повідомлення в Telegram.
//
// Тексти в MAIL дослівні й погоджені. Правити їх можна лише разом зі спеком.

/** Акцент темного шаблону: шавлієвий для входу, бурштиновий для змін, сливовий для паузи. */
export type LetterAccent = 'sage' | 'amber' | 'plum';

export interface LetterButton {
  label: string;
  /** Повна адреса. Складається тим, хто шле: домен знає сервер, не домен. */
  url: string;
}

export interface Letter {
  subject: string;
  /** Заголовок у тілі = тема листа (спек §Тексти). */
  paragraphs: string[];
  button?: LetterButton;
  /** Другий рядок підпису: чому цей лист прийшов. */
  reason: string;
  accent: LetterAccent;
  /**
   * Запасний рядок під кнопкою — «Якщо кнопка не працює, відкрий посилання».
   * Лише для листів, де кнопка і є вся дія (вхід, запрошення): там без лінка
   * людина лишається ні з чим, а в решті він лише шум.
   */
  fallbackLink?: boolean;
}

export const MAIL_SIGNATURE = 'Kitchen OS · hello@kitchen-os.app';
/** Причина для всіх листів, крім входу й запрошення. */
export const REASON_HOUSEHOLD = 'Ти отримуєш цей лист, бо маєш дім у Kitchen OS.';

/**
 * Той самий лист простим текстом: part text/plain для пошти і тіло для
 * Telegram. Тему першим рядком не повторюємо — у пошті вона в заголовку
 * листа, у боті її немає зовсім (спек §Уточнення).
 */
export function letterText(l: Letter, opts: { signature?: boolean } = {}): string {
  const out = [...l.paragraphs];
  if (l.button) {
    out.push(l.fallbackLink
      ? `${l.button.label}: ${l.button.url}`
      : `${l.button.label} — ${l.button.url}`);
  }
  if (opts.signature !== false) out.push(`${MAIL_SIGNATURE}\n${l.reason}`);
  return out.join('\n\n');
}
