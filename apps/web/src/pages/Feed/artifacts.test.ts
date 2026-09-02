import { describe, expect, it } from 'vitest';
import { INTAKE_ARTIFACT_MIN, isIntakeArtifact, pickArtifacts, receiptLines, type ArtifactTurn } from './artifacts';
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
  it('коротка intake-картка артефактом не стає', () => {
    const short = { type: 'intake_diff', ops: Array.from({ length: INTAKE_ARTIFACT_MIN - 1 }, () => ({ op: 'add' })) } as Partial<ChatCard>;
    expect(isIntakeArtifact(turn('a', short))).toBe(false);
  });

  // А от довга — стає, і без жодного джерела. Живий репро 02.09: чек,
  // вставлений ТЕКСТОМ у поле вводу, raw_kind не має взагалі, і двадцять
  // рядків гортались разом із розмовою.
  it('довгий перелік без джерела — стає, бо він документ', () => {
    const long = { type: 'intake_diff', ops: Array.from({ length: INTAKE_ARTIFACT_MIN }, () => ({ op: 'add' })) } as Partial<ChatCard>;
    expect(isIntakeArtifact(turn('a', long))).toBe(true);
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

  it('бере ОСТАННІЙ свого роду, а не перший', () => {
    const got = pickArtifacts([
      turn('c1', { type: 'cart', rows: [{}, {}] as never }),
      turn('c2', { type: 'cart', rows: [{}, {}, {}] as never }),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]!.turn!.id).toBe('c2');
    expect(got[0]!.meta).toBe('3');
  });

  it('довгий перелік без джерела зветься «Комора», а не «Чек»', () => {
    const long = { type: 'intake_diff', ops: Array.from({ length: 20 }, () => ({ op: 'add' })) } as Partial<ChatCard>;
    const got = pickArtifacts([turn('d', long)]);
    expect(got.map((a) => a.label)).toEqual(['Комора']);
    expect(got[0]!.meta).toBe('20');
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

describe('список як артефакт', () => {
  // Список не з'являється сам: інакше кожна сесія починалася б із вкладки,
  // якої ніхто не просив. Його відкривають — слідом або ярликом.
  it('без відкриття вкладки списку немає', () => {
    expect(pickArtifacts([turn('k', { type: 'cart', rows: [{}] as never })]).map((a) => a.key))
      .toEqual(['cart']);
  });

  it('відкритий список стає останньою вкладкою і не має ходу', () => {
    const got = pickArtifacts([turn('k', { type: 'cart', rows: [{}] as never })], 9);
    expect(got.map((a) => a.key)).toEqual(['cart', 'list']);
    expect(got[1]!.meta).toBe('9');
    expect(got[1]!.turn).toBe(null);
  });

  it('порожній список — це теж відкритий список, а не його відсутність', () => {
    expect(pickArtifacts([], 0).map((a) => a.key)).toEqual(['list']);
  });
});
