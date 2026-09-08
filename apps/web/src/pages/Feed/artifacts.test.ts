import { describe, expect, it } from 'vitest';
import { isIntakeArtifact, pickArtifacts, receiptLines, type ArtifactTurn, isWriteOff, survivingBatches, goneLabels, type LiveBatch } from './artifacts';
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

// Списання після готування. Живий репро 02.09: після карбонари в стрічці
// стояла пігулка «У КОМОРУ · 4 ПОЗИЦІЇ / 4 у комору →», і вона:
//   · брехала словами — картка ЗАБИРАЄ з комори, а казала «у комору»;
//   · не натискалась — артефакта в неї немає (нічого не додалось), тож
//     стрілка «→» вела в порожнечу.
// Причина спільна: isIntakeArtifact віддавав true на будь-який intake_diff,
// не розрізняючи наповнення й списання.
describe('isWriteOff — списання це подія, а не річ', () => {
  const card = (ops: { op: string; label: string }[]) => ({ id: 't', card: { type: 'intake_diff', ops } });

  it('ops без жодного add — це списання', () => {
    expect(isWriteOff(card([
      { op: 'correct', label: 'спагеті Barilla' },
      { op: 'deplete', label: 'бекон нарізка' },
    ]) as never)).toBe(true);
  });

  it('є хоч один add — це наповнення, не списання', () => {
    expect(isWriteOff(card([
      { op: 'add', label: 'молоко' },
      { op: 'correct', label: 'хліб' },
    ]) as never)).toBe(false);
  });

  it('порожні ops не роблять картку списанням', () => {
    // Малформлена картка моделі не має міняти вигляд сліду.
    expect(isWriteOff(card([]) as never)).toBe(false);
  });

  it('інші типи карток списанням не бувають', () => {
    expect(isWriteOff({ id: 't', card: { type: 'shopping', items: [] } } as never)).toBe(false);
    expect(isWriteOff({ id: 't', card: null } as never)).toBe(false);
  });

  it('списання НЕ стає артефактом, наповнення стає', () => {
    // Саме ця різниця й лишала стрілку без цілі: слід малювався, артефакт ні.
    const wo = { id: 'a', cardId: 'a', card: { type: 'intake_diff', ops: [{ op: 'correct', label: 'x' }] } };
    const fill = { id: 'b', cardId: 'b', card: { type: 'intake_diff', ops: [{ op: 'add', label: 'y' }] } };
    expect(pickArtifacts([wo] as never).length, 'списання не артефакт').toBe(0);
    expect(pickArtifacts([fill] as never).length, 'наповнення артефакт').toBe(1);
  });
});

// П6-Т3. Списання досі малювалось одним способом на два різні випадки.
// Після «зʼїли все» партії немає — рядок тексту без стрілки правильний.
// Після «зʼїли половину» партія ЖИВА з новим числом, і сховати її за тим
// самим рядком означає не показати єдине, що людина хоче побачити.
describe('survivingBatches — часткове списання лишає що показати', () => {
  const live = (...ids: string[]): Map<string, LiveBatch> =>
    new Map(ids.map((id) => [id, { label: `позиція ${id}`, value: 250, unit: 'g' }]));
  const wo = (ops: unknown[], extra: Partial<ArtifactTurn> = {}): ArtifactTurn =>
    ({ id: 't', cardId: 't', card: { type: 'intake_diff', ops } as never, applied: true, ...extra });

  it('партія лишилась у живих — її й показуємо', () => {
    const t = wo([{ op: 'correct', label: 'томати', batch_id: 'b1', value: 250 }]);
    expect(survivingBatches(t, live('b1'))).toEqual([{ id: 'b1', label: 'позиція b1', value: 250, unit: 'g' }]);
    expect(goneLabels(t, live('b1')), 'жива позиція в текстовий рядок не йде').toEqual([]);
  });

  it('повне списання: партії в живих немає — показувати нема чого', () => {
    const t = wo([{ op: 'deplete', label: 'томати', batch_id: 'b1' }]);
    expect(survivingBatches(t, live())).toEqual([]);
    expect(goneLabels(t, live())).toEqual(['томати']);
  });

  it('мішана картка: жива йде в слід, зʼїдена — в рядок тексту', () => {
    const t = wo([
      { op: 'correct', label: 'спагеті', batch_id: 'b1', value: 100 },
      { op: 'deplete', label: 'бекон', batch_id: 'b2' },
    ]);
    expect(survivingBatches(t, live('b1')).map((b) => b.id)).toEqual(['b1']);
    expect(goneLabels(t, live('b1'))).toEqual(['бекон']);
  });

  it('без batch_id адресувати нічого: слід лишається текстом', () => {
    // Старі картки в історії (до того, як сервер став ставити вказівник на
    // правках) — і саме тому назву тут за ключ не беремо: findBatchByLabel
    // повертає ПЕРШИЙ збіг, і при двох однойменних відкрилась би не та.
    const t = wo([{ op: 'correct', label: 'томати', value: 250 }]);
    expect(survivingBatches(t, live('b1'))).toEqual([]);
    expect(goneLabels(t, live('b1'))).toEqual(['томати']);
  });

  it('незастосована й скасована картка партії не міняли', () => {
    const ops = [{ op: 'correct', label: 'томати', batch_id: 'b1', value: 250 }];
    expect(survivingBatches(wo(ops, { applied: false }), live('b1'))).toEqual([]);
    expect(survivingBatches(wo(ops, { undone: true }), live('b1'))).toEqual([]);
  });

  it('наповнення слідом списання не стає', () => {
    const t = wo([{ op: 'add', label: 'томати', batch_id: 'b1' }]);
    expect(survivingBatches(t, live('b1'))).toEqual([]);
    expect(goneLabels(t, live('b1'))).toEqual([]);
  });
});

describe('pickArtifacts — жива партія стає вкладкою batch', () => {
  const live = new Map<string, LiveBatch>([['b1', { label: 'томати', value: 250, unit: 'g' }]]);

  it('часткове списання відкриває вкладку позиції, повне — ні', () => {
    const partial = { id: 'a', cardId: 'a', applied: true, card: { type: 'intake_diff', ops: [{ op: 'correct', label: 'томати', batch_id: 'b1', value: 250 }] } };
    const full = { id: 'c', cardId: 'c', applied: true, card: { type: 'intake_diff', ops: [{ op: 'deplete', label: 'бекон', batch_id: 'b9' }] } };
    expect(pickArtifacts([partial] as never, null, live)).toEqual([
      { key: 'batch:b1', kind: 'batch', label: 'томати', meta: '', turn: partial },
    ]);
    expect(pickArtifacts([full] as never, null, live)).toEqual([]);
  });

  it('без мапи живих партій екран лишається таким, як був', () => {
    const partial = { id: 'a', cardId: 'a', applied: true, card: { type: 'intake_diff', ops: [{ op: 'correct', label: 'томати', batch_id: 'b1' }] } };
    expect(pickArtifacts([partial] as never)).toEqual([]);
  });

  it('два списання тієї самої партії — одна вкладка, не дві', () => {
    // Партія — це стан, а не документ ходу: другий обід із тих самих томатів
    // не заводить другої картки позиції.
    const one = { id: 'a', cardId: 'a', applied: true, card: { type: 'intake_diff', ops: [{ op: 'correct', label: 'томати', batch_id: 'b1' }] } };
    const two = { id: 'b', cardId: 'b', applied: true, card: { type: 'intake_diff', ops: [{ op: 'correct', label: 'томати', batch_id: 'b1' }] } };
    expect(pickArtifacts([one, two] as never, null, live).map((a) => a.key)).toEqual(['batch:b1']);
  });
});
