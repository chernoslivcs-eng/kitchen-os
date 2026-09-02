// «Немає ні чека, ні комори — є позиції, які ми бачимо перед очима. А комора
// і чек це просто місця їх відображення» (власник, 02.09).
//
// Досі ми будували ТРИ механізми там, де є одна річ: внести чек, виправити
// рядок чека (receipt-patch.ts), виправити комору. Два останні існували лише
// щоб тримати дві копії позиції в згоді — і все одно розходились: у картці
// стояло «пап 80 туан зев пур мойст», у коморі «папір».
//
// Напрямок посилання односторонній, і це головне в цьому файлі. Спершу я
// зробив навпаки — дав позиції поле origin_message_id — і це було хибно:
// «позиція не повинна знати, де вона народилася… навіть коли людина видалить
// сесію з цим чеком, позиція все одно збережеться». Тобто картка вказує на
// позицію, а не позиція на картку.
//
// Приклад, який задає семантику. Купив кілограм мʼяса, вдома одразу смажиш
// шматок — лишається 700 г. Це не правка чека і не правка комори: це життя
// ОДНІЄЇ позиції, і обидва вікна показують її нову кількість.

import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { InMemoryRepo } from '../in-memory-repo.js';
import { createPending, applyCard } from '../apply.js';
import type { IntakeCard, IntakeOp } from '../types.js';

async function apply(repo: InMemoryRepo, who: { household_id: string; user_id: string }, card: IntakeCard) {
  const message_id = randomUUID();
  await createPending(repo, { message_id, ...who, card });
  await applyCard(repo, message_id, [], who.user_id);
  return message_id;
}
const adds = (card: IntakeCard) => (card.ops as IntakeOp[]).filter((o) => o.op === 'add');

describe('картка вказує на позицію, не навпаки', () => {
  const who = () => ({ household_id: randomUUID(), user_id: randomUUID() });

  it('після застосування кожен add несе id своєї позиції', async () => {
    const repo = new InMemoryRepo();
    const w = who();
    const card: IntakeCard = {
      type: 'intake_diff',
      ops: [
        { op: 'add', label: 'мʼясо', value: 1000, unit: 'g' },
        { op: 'add', label: 'молоко', value: 1000, unit: 'ml' },
      ],
    };
    await apply(repo, w, card);
    const batches = await repo.listBatches(w.household_id);
    const ids = new Set(batches.map((b) => b.id));
    for (const op of adds(card)) {
      expect(op.batch_id, `${op.label} має вказівник`).toBeTruthy();
      expect(ids.has(op.batch_id!), `${op.label} вказує на живу позицію`).toBe(true);
    }
  });

  it('позиція НЕ несе зворотного посилання на картку', async () => {
    // Найважливіше твердження файлу. Якби воно було, видалення сесії тягло б
    // за собою або втрату позиції, або висяче посилання.
    const repo = new InMemoryRepo();
    const w = who();
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'add', label: 'мʼясо', value: 1000, unit: 'g' }] });
    const b = (await repo.listBatches(w.household_id))[0]! as unknown as Record<string, unknown>;
    for (const field of ['origin_message_id', 'card_id', 'message_id', 'session_id']) {
      expect(b[field], `партія не має знати про ${field}`).toBeUndefined();
    }
  });

  it('вказівники зберігаються, а не живуть у памʼяті процесу', async () => {
    const repo = new InMemoryRepo();
    const w = who();
    const message_id = await apply(repo, w, {
      type: 'intake_diff', ops: [{ op: 'add', label: 'хліб', value: 400, unit: 'g' }],
    });
    // Читаємо картку заново — так, як її прочитає стрічка після перезавантаження.
    const saved = (await repo.getPending(message_id))!.card as IntakeCard;
    expect(adds(saved)[0]!.batch_id).toBeTruthy();
  });

  it('зʼїли частину: та сама позиція, менша кількість, той самий вказівник', async () => {
    // Купив кілограм, засмажив шматок. Не нова позиція і не новий запис.
    const repo = new InMemoryRepo();
    const w = who();
    const card: IntakeCard = {
      type: 'intake_diff', ops: [{ op: 'add', label: 'мʼясо', value: 1000, unit: 'g' }],
    };
    await apply(repo, w, card);
    const pointer = adds(card)[0]!.batch_id!;

    await apply(repo, w, {
      type: 'intake_diff', ops: [{ op: 'correct', label: 'мʼясо', value: 700, unit: 'g' }],
    });

    const after = await repo.listBatches(w.household_id);
    expect(after, 'копії не зʼявилось').toHaveLength(1);
    expect(after[0]!.id, 'картка й далі показує на ту саму позицію').toBe(pointer);
    expect(after[0]!.value).toBe(700);
  });

  it('перейменування не рве вказівник картки', async () => {
    const repo = new InMemoryRepo();
    const w = who();
    const card: IntakeCard = {
      type: 'intake_diff', ops: [{ op: 'add', label: 'мʼясо', value: 1000, unit: 'g' }],
    };
    await apply(repo, w, card);
    const pointer = adds(card)[0]!.batch_id!;
    await apply(repo, w, {
      type: 'intake_diff', ops: [{ op: 'rename', label: 'мʼясо', to: 'свинина' }],
    });
    const b = (await repo.listBatches(w.household_id))[0]!;
    expect(b.id).toBe(pointer);
    expect(b.label).toBe('свинина');
  });
});

// Списання після готування знає ТОЧНУ позицію: рецепт тримає палець на
// партії (ing.p → batch id). Досі цей палець перетворювався на назву, а
// назва шукалась findBatchByLabel — перший збіг без сортування. При двох
// однойменних позиціях списувалась не та, яку взяв рецепт.
describe('позицію адресує вказівник, а не назва', () => {
  const who = () => ({ household_id: randomUUID(), user_id: randomUUID() });

  it('дві однойменні позиції: списується саме та, на яку вказали', async () => {
    const repo = new InMemoryRepo();
    const w = who();
    const first: IntakeCard = {
      type: 'intake_diff', ops: [{ op: 'add', label: 'мʼясо', value: 500, unit: 'g' }],
    };
    const second: IntakeCard = {
      type: 'intake_diff', ops: [{ op: 'add', label: 'мʼясо', value: 300, unit: 'g' }],
    };
    await apply(repo, w, first);
    await apply(repo, w, second);
    const targetId = adds(second)[0]!.batch_id!;

    await apply(repo, w, {
      type: 'intake_diff', ops: [{ op: 'deplete', label: 'мʼясо', batch_id: targetId }],
    });

    const live = (await repo.listBatches(w.household_id)).filter((b) => b.state !== 'depleted');
    expect(live, 'лишилась одна').toHaveLength(1);
    expect(live[0]!.id, 'вижила ПЕРША, бо списували другу').toBe(adds(first)[0]!.batch_id);
    expect(live[0]!.value).toBe(500);
  });

  it('без вказівника працює по назві, як і раніше', async () => {
    // Модель id не бачить, тож її операції мусять і далі проходити.
    const repo = new InMemoryRepo();
    const w = who();
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко', value: 1000, unit: 'ml' }] });
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'deplete', label: 'молоко' }] });
    const live = (await repo.listBatches(w.household_id)).filter((b) => b.state !== 'depleted');
    expect(live).toHaveLength(0);
  });

  it('чужий вказівник ігнорується — не можна списати позицію іншого дому', async () => {
    const repo = new InMemoryRepo();
    const mine = who();
    const other = who();
    await apply(repo, other, { type: 'intake_diff', ops: [{ op: 'add', label: 'мʼясо', value: 900, unit: 'g' }] });
    const stolen = (await repo.listBatches(other.household_id))[0]!.id;
    await apply(repo, mine, { type: 'intake_diff', ops: [{ op: 'add', label: 'мʼясо', value: 500, unit: 'g' }] });

    await apply(repo, mine, {
      type: 'intake_diff', ops: [{ op: 'deplete', label: 'мʼясо', batch_id: stolen }],
    });

    const theirs = (await repo.listBatches(other.household_id))[0]!;
    expect(theirs.state, 'чужа позиція недоторкана').not.toBe('depleted');
  });
});
