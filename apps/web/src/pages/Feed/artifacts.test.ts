import { describe, expect, it } from 'vitest';
import { isReceipt, pickArtifacts, receiptLines, type ArtifactTurn } from './artifacts';
import type { ChatCard } from '../../api';

const turn = (id: string, card: Partial<ChatCard> | null, cardId: string | null = id): ArtifactTurn =>
  ({ id, cardId, card: card as ChatCard | null });

const chatReceiptCard = (ops: number): Partial<ChatCard> => ({
  type: 'intake_diff',
  ops: Array.from({ length: ops }, () => ({ op: 'add' })),
  source: { kind: 'chat_receipt', at: '2026-09-02T06:59:00Z' },
} as Partial<ChatCard>);

const receiptCard = (ops: number, nonfood: number, unmatched: number): Partial<ChatCard> => ({
  type: 'intake_diff',
  ops: Array.from({ length: ops }, () => ({ op: 'add' })),
  source: {
    kind: 'retail_receipt', provider: 'silpo', shop: 'Київська, 10',
    at: '2026-08-23T10:00:00Z', total: 1284,
    nonfood: Array.from({ length: nonfood }, () => ({ name: 'Дрова', quantity: 1, unit: 'шт', price: 259, image: null })),
    unmatched: Array.from({ length: unmatched }, () => ({ name: '?', quantity: 1, unit: 'шт', price: 10, image: null })),
  },
} as Partial<ChatCard>);

describe('isReceipt', () => {
  it('чек мережі — так', () => {
    expect(isReceipt(turn('a', receiptCard(11, 5, 1)))).toBe(true);
  });

  it('чек із чату — теж так', () => {
    expect(isReceipt(turn('a', chatReceiptCard(20)))).toBe(true);
  });

  // Головна межа кроку 4.1: артефактом стає ЧЕК, а не будь-який intake.
  // «Поклав молоко в холодильник» і списання після готування мусять
  // лишитись картками у стрічці — інакше кожна побутова дія відкривала б
  // вкладку в панелі. Довжина тут ні до чого: рішення про рід картки
  // ухвалює сервер за raw_kind, а не ми за кількістю рядків.
  it('звичайний intake без джерела — ні, навіть із двадцятьма ops', () => {
    expect(isReceipt(turn('a', { type: 'intake_diff', ops: Array.from({ length: 20 }, () => ({ op: 'add' })) }))).toBe(false);
  });

  it('інші типи карток — ні', () => {
    expect(isReceipt(turn('a', { type: 'cart' }))).toBe(false);
    expect(isReceipt(turn('a', { type: 'recipe_link' }))).toBe(false);
    expect(isReceipt(turn('a', null))).toBe(false);
  });
});

describe('receiptLines', () => {
  it('рахує всі три групи, не тільки ті, що поїдуть у комору', () => {
    expect(receiptLines(turn('a', receiptCard(11, 5, 3)))).toBe(19);
  });
  it('чек із чату — самі ops: розкладки каталогу в нього немає', () => {
    expect(receiptLines(turn('a', chatReceiptCard(20)))).toBe(20);
  });
  it('не чек — нуль', () => {
    expect(receiptLines(turn('a', { type: 'cart' }))).toBe(0);
    expect(receiptLines(undefined)).toBe(0);
  });
});

describe('pickArtifacts', () => {
  it('порожня сесія — жодного артефакта (V8: панелі там немає взагалі)', () => {
    expect(pickArtifacts([])).toEqual([]);
    expect(pickArtifacts([turn('a', { type: 'proposal' })])).toEqual([]);
  });

  it('бере ОСТАННІЙ свого роду, а не перший', () => {
    const got = pickArtifacts([
      turn('c1', { type: 'cart', rows: [{}, {}] as never }),
      turn('c2', { type: 'cart', rows: [{}, {}, {}] as never }),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]!.turn.id).toBe('c2');
    expect(got[0]!.meta).toBe('3');
  });

  it('три роди разом — і порядок сталий: кошик, рецепт, чек', () => {
    const got = pickArtifacts([
      turn('r', { type: 'recipe_link', title: 'Стейк портерхаус' }),
      turn('k', { type: 'cart', rows: [{}] as never }),
      turn('ch', receiptCard(11, 5, 3)),
    ]);
    expect(got.map((a) => a.key)).toEqual(['cart', 'recipe', 'receipt']);
    expect(got.map((a) => a.label)).toEqual(['Кошик', 'Стейк портерхаус', 'Чек']);
    expect(got[2]!.meta).toBe('19');
  });

  // cardId — це адреса, за якою правлять рядок. Без нього ані степер
  // кошика, ані «уточнити» в чеку не мають куди звертатись.
  it('кошик і чек без cardId не стають артефактами', () => {
    expect(pickArtifacts([turn('k', { type: 'cart', rows: [{}] as never }, null)])).toEqual([]);
    expect(pickArtifacts([turn('ch', receiptCard(2, 0, 0), null)])).toEqual([]);
  });

  it('рецепт без cardId — стає: він читається за recipe_id, не за карткою', () => {
    const got = pickArtifacts([turn('r', { type: 'recipe_link', title: 'Борщ' }, null)]);
    expect(got.map((a) => a.key)).toEqual(['recipe']);
  });
});
