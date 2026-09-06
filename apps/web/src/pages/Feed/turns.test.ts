// Пул-9 №2: вкладення переживають перезавантаження історії. Раніше сервер
// підміняв текст ходу на «[вкладення]», а самі файли ніде не жили — після F5
// відкрити те, що людина закинула, було неможливо.

import { describe, expect, it } from 'vitest';
import { attachmentKind, messageToTurn } from './turns';
import type { MessageInfo } from '../../api';

const msg = (over: Partial<MessageInfo> = {}): MessageInfo => ({
  id: 'm1',
  session_id: 's1',
  role: 'user',
  text: null,
  card: null,
  applied: 0,
  created_at: '2026-09-06T09:07:00Z',
  ...over,
});

describe('attachmentKind', () => {
  it('mime → вид', () => {
    expect(attachmentKind('image/jpeg')).toBe('image');
    expect(attachmentKind('image/heic')).toBe('image');
    expect(attachmentKind('application/pdf')).toBe('pdf');
    expect(attachmentKind('text/plain')).toBe('text');
    // Невідоме й порожнє — не картинка й не PDF, отже текст: у чіпі це «TXT»,
    // а не порожній квадрат.
    expect(attachmentKind(null)).toBe('text');
    expect(attachmentKind(undefined)).toBe('text');
  });
});

describe('messageToTurn: вкладення', () => {
  it('перенесення історії дає хід із вкладеннями', () => {
    const t = messageToTurn(msg({
      attachments: [
        { id: 'a1', mime: 'image/jpeg' },
        { id: 'a2', mime: 'application/pdf' },
      ],
    }));
    expect(t.attachments).toEqual([
      { id: 'a1', kind: 'image' },
      { id: 'a2', kind: 'pdf' },
    ]);
  });

  it('є текст — лишається і текст, і вкладення', () => {
    const t = messageToTurn(msg({ text: 'ось чек', attachments: [{ id: 'a1', mime: 'image/png' }] }));
    expect(t.text).toBe('ось чек');
    expect(t.attachments).toHaveLength(1);
  });

  it('нема тексту — і немає підпису за людину', () => {
    const t = messageToTurn(msg({ attachments: [{ id: 'a1', mime: 'image/png' }] }));
    expect(t.text).toBeUndefined();
  });

  it('хід без файлів не тягне порожнього масиву', () => {
    expect(messageToTurn(msg({ text: 'привіт' })).attachments).toBeUndefined();
    expect(messageToTurn(msg({ text: 'привіт', attachments: [] })).attachments).toBeUndefined();
  });
});
