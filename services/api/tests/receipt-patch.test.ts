// Крок 4.4: правка одного рядка чека після застосування.
//
// Це та частина, заради якої чек узагалі став артефактом: у нього стабільна
// адреса, тож уточнення з чату править ОДИН рядок, а не перезбирає картку.
import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryRepo, type Card, type IntakeOp } from '@kitchen/domain';
import { patchReceiptRows } from '../src/receipt-patch.js';

const SESSION = 'sess-1';

function receipt(): Card {
  return {
    type: 'intake_diff',
    ops: [
      { op: 'add', label: 'Хліб Салтівський особл.', value: 500, unit: 'g' },
      { op: 'add', label: 'Молоко Яготинське', value: 1000, unit: 'ml' },
    ],
    source: { kind: 'chat_receipt', at: '2026-09-02T07:00:00Z' },
  } as Card;
}

async function seed(repo: InMemoryRepo, card: Card = receipt(), id = 'msg-receipt') {
  await repo.saveMessage({
    id, session_id: SESSION, role: 'assistant',
    text: null, card, applied: 2, created_at: '2026-09-02T07:00:00Z',
  });
  return id;
}

const rowsOf = async (repo: InMemoryRepo, id: string) => {
  const msgs = await repo.listMessages(SESSION);
  return ((msgs.find((m) => m.id === id)!.card as Card & { ops?: IntakeOp[] }).ops ?? []);
};

describe('patchReceiptRows', () => {
  let repo: InMemoryRepo;
  beforeEach(() => { repo = new InMemoryRepo(); });

  it('rename править рівно той рядок, який назвали', async () => {
    const id = await seed(repo);
    const n = await patchReceiptRows(repo, SESSION, [
      { op: 'rename', label: 'Хліб Салтівський особл.', to: 'Батон' } as IntakeOp,
    ]);
    expect(n).toBe(1);
    const rows = await rowsOf(repo, id);
    expect(rows[0]).toMatchObject({ label: 'Батон', value: 500, unit: 'g' });
    // Сусідній рядок не зачеплений — це і є «правимо один рядок, а не
    // перезбираємо чек».
    expect(rows[1]).toMatchObject({ label: 'Молоко Яготинське', value: 1000 });
  });

  it('correct править кількість, не чіпаючи назви', async () => {
    const id = await seed(repo);
    await patchReceiptRows(repo, SESSION, [
      { op: 'correct', label: 'Молоко Яготинське', value: 900, unit: 'ml' } as IntakeOp,
    ]);
    const rows = await rowsOf(repo, id);
    expect(rows[1]).toMatchObject({ label: 'Молоко Яготинське', value: 900, unit: 'ml' });
  });

  // Збіг точний за назвою (trim+lower) — той самий, що applyCard уже
  // використовує для списку покупок (UX9-27). Не вигадуємо другого правила.
  it('регістр і пробіли не заважають', async () => {
    const id = await seed(repo);
    const n = await patchReceiptRows(repo, SESSION, [
      { op: 'rename', label: '  хліб салтівський особл.  ', to: 'Батон' } as IntakeOp,
    ]);
    expect(n).toBe(1);
    expect((await rowsOf(repo, id))[0]).toMatchObject({ label: 'Батон' });
  });

  it('назви немає в чеку — нічого не правимо й не падаємо', async () => {
    const id = await seed(repo);
    const n = await patchReceiptRows(repo, SESSION, [
      { op: 'rename', label: 'Кава', to: 'Чай' } as IntakeOp,
    ]);
    expect(n).toBe(0);
    expect((await rowsOf(repo, id))[0]).toMatchObject({ label: 'Хліб Салтівський особл.' });
  });

  // Межа: звичайна intake-картка чеком не є, і правити її рядки не можна —
  // інакше «поклав молоко» ловило б будь-яке перейменування в сесії.
  it('не-чек не чіпаємо', async () => {
    const plain = { type: 'intake_diff', ops: [{ op: 'add', label: 'Хліб Салтівський особл.' }] } as Card;
    const id = await seed(repo, plain, 'msg-plain');
    const n = await patchReceiptRows(repo, SESSION, [
      { op: 'rename', label: 'Хліб Салтівський особл.', to: 'Батон' } as IntakeOp,
    ]);
    expect(n).toBe(0);
    expect((await rowsOf(repo, id))[0]).toMatchObject({ label: 'Хліб Салтівський особл.' });
  });

  it('add і deplete нічого не правлять — це не уточнення', async () => {
    const id = await seed(repo);
    const n = await patchReceiptRows(repo, SESSION, [
      { op: 'add', label: 'Хліб Салтівський особл.', value: 1 } as IntakeOp,
      { op: 'deplete', label: 'Молоко Яготинське' } as IntakeOp,
    ]);
    expect(n).toBe(0);
    expect((await rowsOf(repo, id))[0]).toMatchObject({ label: 'Хліб Салтівський особл.' });
  });

  it('порожній список операцій — нуль звернень до сховища', async () => {
    await seed(repo);
    expect(await patchReceiptRows(repo, SESSION, [])).toBe(0);
    expect(await patchReceiptRows(repo, SESSION, undefined)).toBe(0);
  });

  it('чек мережі правиться так само, як чек із чату', async () => {
    const net = {
      type: 'intake_diff',
      ops: [{ op: 'add', label: 'Хліб Салтівський особл.', value: 500, unit: 'g' }],
      source: {
        kind: 'retail_receipt', provider: 'silpo', shop: 'Київська, 10',
        at: '2026-08-23T10:00:00Z', total: 1284, nonfood: [], unmatched: [],
      },
    } as unknown as Card;
    const id = await seed(repo, net, 'msg-net');
    expect(await patchReceiptRows(repo, SESSION, [
      { op: 'rename', label: 'Хліб Салтівський особл.', to: 'Батон' } as IntakeOp,
    ])).toBe(1);
    expect((await rowsOf(repo, id))[0]).toMatchObject({ label: 'Батон' });
  });
});
