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
import { buildWriteoffOps } from '../src/post-cook.js';

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

// §2а спека (30.09): готування з пачки дає ПАРУ операцій — «−1 шт» і «+залишок».
// Людина при цьому списала частину пачки, а не «мінус штука, плюс грами». Тому
// сервер позначає пару: скільки саме пішло в страву (`used`) і який рядок є
// залишком (`remainder`). Веб малює один рядок «−250 г» і залишок не рахує.
describe('used і remainder після готування', () => {
  let repo2: InMemoryRepo; let app2: ReturnType<typeof buildApp>; let mailer2: ConsoleMailer;
  beforeEach(async () => {
    repo2 = new InMemoryRepo(); mailer2 = new ConsoleMailer();
    app2 = buildApp(repo2, new InMemoryStore(), mailer2); await app2.ready();
  });

  const seedPack = async (h: string, u: string, qty: number, pack: number) => {
    const message_id = randomUUID();
    await createPending(repo2, {
      message_id, household_id: h, user_id: u,
      card: { type: 'intake_diff', ops: [{ op: 'add', label: 'макарони', qty, pack: { v: pack, u: 'g' }, zone: 'dry' }] },
    });
    await applyCard(repo2, message_id, [], u);
    return (await repo2.listBatches(h)).find((b) => b.label === 'макарони')!;
  };

  it('пачка 2×500 г, рецепт бере 250 г → correct.used 250 г і add.remainder', async () => {
    const me = await signIn(app2, mailer2, 'u1@example.com');
    const batch = await seedPack(me.household_id, me.user_id, 2, 500);
    const ops = await buildWriteoffOps(repo2, me.household_id, {
      ing: [{ p: batch.id, n: 'макарони', v: 250, u: 'g' }],
    } as never);

    const corr = ops.find((o) => o.op === 'correct')!;
    // Штуки лишаються штуками — але поруч стоїть, скільки пішло в страву.
    expect(corr).toMatchObject({ op: 'correct', unit: 'pcs', used: { value: 250, unit: 'g' } });
    const add = ops.find((o) => o.op === 'add')!;
    expect(add).toMatchObject({ remainder: true, value: 250, unit: 'g' });
  });

  it('вагова партія 500 г, рецепт бере 320 г → used 320 г поруч із залишком 180', async () => {
    const me = await signIn(app2, mailer2, 'u2@example.com');
    const message_id = randomUUID();
    await createPending(repo2, {
      message_id, household_id: me.household_id, user_id: me.user_id,
      card: { type: 'intake_diff', ops: [{ op: 'add', label: 'фарш', value: 500, unit: 'g', zone: 'fridge' }] },
    });
    await applyCard(repo2, message_id, [], me.user_id);
    const batch = (await repo2.listBatches(me.household_id)).find((b) => b.label === 'фарш')!;

    const ops = await buildWriteoffOps(repo2, me.household_id, {
      ing: [{ p: batch.id, n: 'фарш', v: 320, u: 'g' }],
    } as never);
    expect(ops[0]).toMatchObject({ op: 'correct', value: 180, unit: 'g', used: { value: 320, unit: 'g' } });
  });

  it('партія менша за потрібне → deplete, і used каже, що пішла вся', async () => {
    const me = await signIn(app2, mailer2, 'u3@example.com');
    const message_id = randomUUID();
    await createPending(repo2, {
      message_id, household_id: me.household_id, user_id: me.user_id,
      card: { type: 'intake_diff', ops: [{ op: 'add', label: 'вершки', value: 200, unit: 'ml', zone: 'fridge' }] },
    });
    await applyCard(repo2, message_id, [], me.user_id);
    const batch = (await repo2.listBatches(me.household_id)).find((b) => b.label === 'вершки')!;

    const ops = await buildWriteoffOps(repo2, me.household_id, {
      ing: [{ p: batch.id, n: 'вершки', v: 500, u: 'ml' }],
    } as never);
    expect(ops[0]).toMatchObject({ op: 'deplete', used: { value: 200, unit: 'ml' } });
  });

  it('залишок з уже відкритої пачки: used на ній — саме взяте, не весь залишок', async () => {
    const me = await signIn(app2, mailer2, 'u4@example.com');
    const pack = await seedPack(me.household_id, me.user_id, 2, 500);
    // Відкрита пачка того самого продукту з 300 г — беруть спершу з неї.
    const open_id = randomUUID();
    await createPending(repo2, {
      message_id: open_id, household_id: me.household_id, user_id: me.user_id,
      card: { type: 'intake_diff', ops: [{ op: 'add', label: 'макарони', value: 300, unit: 'g', zone: 'dry', state: 'opened' }] },
    });
    await applyCard(repo2, open_id, [], me.user_id);

    const ops = await buildWriteoffOps(repo2, me.household_id, {
      ing: [{ p: pack.id, n: 'макарони', v: 100, u: 'g' }],
    } as never);
    // 100 г цілком беруться з відкритих 300 → лишається 200, пачку не чіпаємо.
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'correct', value: 200, unit: 'g', used: { value: 100, unit: 'g' } });
  });
});
