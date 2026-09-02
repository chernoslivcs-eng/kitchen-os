import { describe, expect, it } from 'vitest';
import type { Card } from '@kitchen/domain';
import { stampChatReceipt } from '../src/receipt-source.js';

const intake = (ops = 20): Card => ({
  type: 'intake_diff',
  ops: Array.from({ length: ops }, () => ({ op: 'add', label: 'молоко' })),
} as Card);

describe('stampChatReceipt', () => {
  it('чек із чату отримує джерело — і стає артефактом панелі', () => {
    const card = intake();
    stampChatReceipt(card, 'receipt');
    expect(card.source?.kind).toBe('chat_receipt');
  });

  // Це і є та межа, заради якої позначка ставиться на сервері: рід картки
  // визначає raw_kind моделі, а не довжина списку. Фото полиці теж дає
  // intake_diff на два десятки рядків — але це не документ, який людина
  // потім читає й править, а разовий звіт.
  it('фото полиці, страви й решта — без джерела', () => {
    for (const kind of ['shelf', 'dish', 'recipe', 'other', null]) {
      const card = intake();
      stampChatReceipt(card, kind);
      expect(card.source, `raw_kind=${kind}`).toBeUndefined();
    }
  });

  it('не intake — не чіпаємо', () => {
    const card = { type: 'proposal', items: [] } as unknown as Card;
    stampChatReceipt(card, 'receipt');
    expect((card as { source?: unknown }).source).toBeUndefined();
  });

  // Чек мережі приходить іншим шляхом і вже має повне джерело з розкладкою
  // каталогу. Перезаписати його бідним chat_receipt означало б втратити
  // nonfood і unmatched — тобто дві з чотирьох груп розбору.
  it('готове джерело мережі не перезаписується', () => {
    const card = {
      type: 'intake_diff',
      ops: [],
      source: {
        kind: 'retail_receipt', provider: 'silpo', shop: 'Київська, 10',
        at: '2026-08-23T10:00:00Z', total: 1284, nonfood: [], unmatched: [],
      },
    } as unknown as Card;
    stampChatReceipt(card, 'receipt');
    expect(card.source?.kind).toBe('retail_receipt');
  });

  it('порожня картка не валить', () => {
    expect(() => stampChatReceipt(null, 'receipt')).not.toThrow();
    expect(() => stampChatReceipt(undefined, 'receipt')).not.toThrow();
  });
});
