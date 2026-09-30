// «Скільки саме списано» — серверний знімок «що було» в момент застосування.
//
// Це число ніде не існувало: `deplete` кількості не несе (і не мусить — правило
// для МОДЕЛІ лишається, інцидент 07.09), а часткове списання після готування —
// це `correct` із ЗАЛИШКОМ у value. Тобто картка знала, що лишилось, і не
// знала, скільки пішло. Тепер сервер дописує в операцію `before` — стан партії
// ДО правки, — і різницю рахує той, хто малює.
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, createPending, applyCard, undoCard, type IntakeCard } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

describe('before у картці списання', () => {
  let repo: InMemoryRepo; let app: ReturnType<typeof buildApp>; let mailer: ConsoleMailer;
  beforeEach(async () => {
    repo = new InMemoryRepo(); mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer); await app.ready();
  });

  const applyAndRead = async (h: string, u: string, card: IntakeCard) => {
    const message_id = randomUUID();
    await createPending(repo, { message_id, household_id: h, user_id: u, card });
    const res = await applyCard(repo, message_id, [], u);
    const saved = (await repo.getPending(message_id))!.card as IntakeCard;
    return { message_id, res, ops: saved.ops };
  };

  const stock = async (h: string, u: string, label: string, value: number, unit: 'g' | 'pcs') => {
    await applyAndRead(h, u, { type: 'intake_diff', ops: [{ op: 'add', label, value, unit, zone: 'fridge' }] });
    return (await repo.listBatches(h)).find((b) => b.label === label)!;
  };

  it('deplete партії 500 г → у картці before 500 г', async () => {
    const me = await signIn(app, mailer, 'b1@example.com');
    await stock(me.household_id, me.user_id, 'фарш', 500, 'g');
    const { ops } = await applyAndRead(me.household_id, me.user_id, {
      type: 'intake_diff', ops: [{ op: 'deplete', label: 'фарш' }],
    });
    // Для deplete списане дорівнює before цілком — окремого числа не треба.
    expect(ops[0]).toMatchObject({ op: 'deplete', before: { value: 500, unit: 'g' } });
  });

  it('correct 200 → 100 г: before 200, value 100 — різниця і є списаним', async () => {
    const me = await signIn(app, mailer, 'b2@example.com');
    await stock(me.household_id, me.user_id, 'сметана', 200, 'g');
    const { ops } = await applyAndRead(me.household_id, me.user_id, {
      type: 'intake_diff', ops: [{ op: 'correct', label: 'сметана', value: 100, unit: 'g' }],
    });
    expect(ops[0]).toMatchObject({ op: 'correct', value: 100, before: { value: 200, unit: 'g' } });
  });

  it('ручна правка кількості: before є, але джерела «cook» немає — веб малює олівець', async () => {
    const me = await signIn(app, mailer, 'b2m@example.com');
    await stock(me.household_id, me.user_id, 'борошно', 1000, 'g');
    const message_id = randomUUID();
    const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'correct', label: 'борошно', value: 700, unit: 'g' }] };
    await createPending(repo, { message_id, household_id: me.household_id, user_id: me.user_id, card });
    await applyCard(repo, message_id, [], me.user_id);
    const saved = (await repo.getPending(message_id))!.card as IntakeCard;
    expect(saved.ops[0]).toMatchObject({ before: { value: 1000, unit: 'g' } });
    expect(saved.source?.kind).not.toBe('cook');
  });

  it('штучна партія: before несе саме штуки, не вагу', async () => {
    const me = await signIn(app, mailer, 'b3@example.com');
    await stock(me.household_id, me.user_id, 'яйця', 10, 'pcs');
    const { ops } = await applyAndRead(me.household_id, me.user_id, {
      type: 'intake_diff', ops: [{ op: 'correct', label: 'яйця', value: 6, unit: 'pcs' }],
    });
    expect(ops[0]).toMatchObject({ before: { value: 10, unit: 'pcs' } });
  });

  it('before від МОДЕЛІ затирається серверним — контракт моделі не міняється', async () => {
    const me = await signIn(app, mailer, 'b4@example.com');
    await stock(me.household_id, me.user_id, 'молоко', 1000, 'g');
    const { ops } = await applyAndRead(me.household_id, me.user_id, {
      // Модель такого не шле й не мусить; якщо надішле — вірити їй тут не можна.
      type: 'intake_diff', ops: [{ op: 'deplete', label: 'молоко', before: { value: 7, unit: 'g' } } as never],
    });
    expect(ops[0]).toMatchObject({ before: { value: 1000, unit: 'g' } });
  });

  it('операції, які не чіпають кількість, before не отримують', async () => {
    const me = await signIn(app, mailer, 'b5@example.com');
    await stock(me.household_id, me.user_id, 'кефір', 500, 'g');
    const { ops } = await applyAndRead(me.household_id, me.user_id, {
      type: 'intake_diff', ops: [{ op: 'open', label: 'кефір' }],
    });
    expect(ops[0]).not.toHaveProperty('before');
  });

  it('промах (партії немає) — before не вигадуємо', async () => {
    const me = await signIn(app, mailer, 'b6@example.com');
    const { ops } = await applyAndRead(me.household_id, me.user_id, {
      type: 'intake_diff', ops: [{ op: 'deplete', label: 'чого-нема' }],
    });
    expect(ops[0]).not.toHaveProperty('before');
  });

  it('після undo картку не можна застосувати вдруге — знімок лишається записом про скасоване', async () => {
    const me = await signIn(app, mailer, 'b7@example.com');
    const b = await stock(me.household_id, me.user_id, 'сир', 300, 'g');
    const { message_id, res, ops } = await applyAndRead(me.household_id, me.user_id, {
      type: 'intake_diff', ops: [{ op: 'deplete', label: 'сир' }],
    });
    expect(ops[0]).toMatchObject({ before: { value: 300, unit: 'g' } });

    await undoCard(repo, message_id, res.undo_token!, me.user_id);
    // Партія повернулась…
    expect((await repo.getBatch(b.id))?.state).toBe('sealed');
    // …а картка позначена скасованою й повторно не застосовується, тож `before`
    // лишається записом про те, що БУЛО зроблено й відкочено, а не обіцянкою.
    expect((await repo.getPending(message_id))?.undone_at).toBeTruthy();
    await expect(applyCard(repo, message_id, [], me.user_id)).rejects.toThrow(/undone/);
  });
});
