import { describe, expect, it } from 'vitest';
import { isIntakeArtifact, pickArtifacts, receiptLines, type ArtifactTurn } from './artifacts';
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

describe('isIntakeArtifact', () => {
  it('чек мережі — так', () => {
    expect(isIntakeArtifact(turn('a', receiptCard(11, 5, 1)))).toBe(true);
  });

  it('чек із чату — теж так', () => {
    expect(isIntakeArtifact(turn('a', chatReceiptCard(20)))).toBe(true);
  });

  // Межа: артефактом стає ДОКУМЕНТ, а не подія. «Поклав молоко» і списання
  // після готування лишаються картками у стрічці — інакше кожна побутова
  // дія відкривала б вкладку в панелі.
  // Порогів за кількістю рядків більше немає: «три банана» — такий самий
  // документ, як чек на двадцять, просто коротший.
  it('коротка intake-картка теж артефакт', () => {
    const short = { type: 'intake_diff', ops: [{ op: 'add' }, { op: 'add' }, { op: 'add' }] } as Partial<ChatCard>;
    expect(isIntakeArtifact(turn('a', short))).toBe(true);
  });

  it('інші типи карток — ні', () => {
    expect(isIntakeArtifact(turn('a', { type: 'cart' }))).toBe(false);
    expect(isIntakeArtifact(turn('a', { type: 'recipe_link' }))).toBe(false);
    expect(isIntakeArtifact(turn('a', null))).toBe(false);
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

  // Головна зміна 02.09: артефакт це КАРТКА, а не рід. Три рецепти в сесії —
  // три артефакти. Заміщення «наступний займає ту саму вкладку» знято: воно
  // робило старий слід брехливим, бо він відкривав новіший документ.
  it('три рецепти в сесії — три артефакти, кожен свій', () => {
    const got = pickArtifacts([
      turn('r1', { type: 'recipe_link', title: 'Борщ' }),
      turn('r2', { type: 'recipe_link', title: 'Плов' }),
      turn('r3', { type: 'recipe_link', title: 'Сирники' }),
    ]);
    expect(got.map((a) => a.label)).toEqual(['Борщ', 'Плов', 'Сирники']);
    expect(new Set(got.map((a) => a.key)).size).toBe(3);
    expect(got.every((a) => a.kind === 'recipe')).toBe(true);
  });

  it('два чеки в сесії — два артефакти', () => {
    const got = pickArtifacts([
      turn('c1', receiptCard(11, 5, 3)),
      turn('c2', receiptCard(4, 0, 0)),
    ]);
    expect(got).toHaveLength(2);
    expect(got.map((a) => a.turn?.id)).toEqual(['c1', 'c2']);
    expect(got.map((a) => a.meta)).toEqual(['19', '4']);
  });

  it('порядок — хронологічний, як у стрічці', () => {
    const got = pickArtifacts([
      turn('r', { type: 'recipe_link', title: 'Борщ' }),
      turn('k', { type: 'cart', rows: [{}] as never }),
      turn('ch', receiptCard(11, 5, 3)),
    ]);
    expect(got.map((a) => a.kind)).toEqual(['recipe', 'cart', 'receipt']);
  });

  it('чек зветься «Чек», перелік без джерела — «Комора»', () => {
    const bare = { type: 'intake_diff', ops: [{ op: 'add' }, { op: 'add' }] } as Partial<ChatCard>;
    expect(pickArtifacts([turn('a', bare)]).map((a) => a.label)).toEqual(['Комора']);
    expect(pickArtifacts([turn('b', receiptCard(2, 0, 0))]).map((a) => a.label)).toEqual(['Чек']);
  });

  // Межа: артефакт — те, що ДОДАЄ. Правка наявного і списання після
  // готування це дії над уже наявним, а не документи; вони лишаються
  // карткою у стрічці й вкладки не відкривають.
  it('правка і списання артефактами не стають', () => {
    const rename = { type: 'intake_diff', ops: [{ op: 'rename', label: 'хліб', to: 'батон' }] } as Partial<ChatCard>;
    const writeoff = { type: 'intake_diff', ops: [{ op: 'deplete' }, { op: 'deplete' }] } as Partial<ChatCard>;
    expect(pickArtifacts([turn('a', rename)])).toEqual([]);
    expect(pickArtifacts([turn('b', writeoff)])).toEqual([]);
  });

  it('кошик і чек без cardId не стають артефактами', () => {
    expect(pickArtifacts([turn('k', { type: 'cart', rows: [{}] as never }, null)])).toEqual([]);
    expect(pickArtifacts([turn('ch', receiptCard(2, 0, 0), null)])).toEqual([]);
  });

  it('рецепт без cardId — стає: він читається за recipe_id, не за карткою', () => {
    const got = pickArtifacts([turn('r', { type: 'recipe_link', title: 'Борщ' }, null)]);
    expect(got.map((a) => a.kind)).toEqual(['recipe']);
  });
});

describe('список як артефакт', () => {
  // Список не з'являється сам: інакше кожна сесія починалася б із вкладки,
  // якої ніхто не просив. Його відкривають — слідом або ярликом.
  it('без відкриття вкладки списку немає', () => {
    expect(pickArtifacts([turn('k', { type: 'cart', rows: [{}] as never })]).map((a) => a.kind))
      .toEqual(['cart']);
  });

  it('відкритий список стає останньою вкладкою і не має ходу', () => {
    const got = pickArtifacts([turn('k', { type: 'cart', rows: [{}] as never })], 9);
    expect(got.map((a) => a.kind)).toEqual(['cart', 'list']);
    expect(got[1]!.meta).toBe('9');
    expect(got[1]!.turn).toBe(null);
  });

  it('порожній список — це теж відкритий список, а не його відсутність', () => {
    expect(pickArtifacts([], 0).map((a) => a.kind)).toEqual(['list']);
  });
});
