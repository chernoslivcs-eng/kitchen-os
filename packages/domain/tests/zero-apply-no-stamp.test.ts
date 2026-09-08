// П4-Т2. Пʼять гілок applyCard писали applied_at, applied_ops, undo_token і
// кликали markMessageApplied БЕЗУМОВНО — навіть коли не лягло нічого.
// У проді таких штампів на нулі три, усі profile; людина 7 вересня побачила
// «Записано в „Про тебе"» на порожньому місці.
//
// Гірше за саму брехню — те, що виходу з неї не було: dismissCard відмовляв
// із «already applied, use undo», бо applied_at уже стояв. Кнопка «Ні»
// переставала працювати саме на тій картці, де вона найпотрібніша.
//
// Після Т2 вихід зʼявляється сам, без нової машини станів: немає applied_at —
// немає й відмови.

import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { InMemoryRepo } from '../in-memory-repo.js';
import { createPending, applyCard, dismissCard } from '../apply.js';
import type { Card } from '../types.js';

async function mk(repo: InMemoryRepo, card: Card) {
  const { user_id, household_id } = await repo.createUserWithHousehold('me@example.com', 'me');
  const message_id = randomUUID();
  await createPending(repo, { message_id, household_id, user_id, card });
  return { message_id, user_id, household_id };
}

// Ops-картка профілю вміє тільки kind: 'member'. Будь-який інший kind —
// гілка не робить нічого. Саме ця форма й дала три штампи на нулі в проді.
const unknownOp = {
  type: 'profile',
  ops: [{ kind: 'preference', op: 'add', label: 'люблю гостре' }],
} as unknown as Card;

describe('нульове застосування картки не штампується', () => {
  it('card_pending не отримує applied_at, applied_ops і undo_token', async () => {
    const repo = new InMemoryRepo();
    const { message_id, user_id } = await mk(repo, unknownOp);

    const r = await applyCard(repo, message_id, [], user_id);
    expect(r.applied).toBe(0);
    expect(r.undo_token).toBeNull();

    const pc = await repo.getPending(message_id);
    expect(pc?.applied_at).toBeNull();
    expect(pc?.applied_ops).toBeNull();
    expect(pc?.undo_token).toBeNull();
  });

  it('після нульового застосування «Ні» працює — dismissCard не кидає already applied', async () => {
    const repo = new InMemoryRepo();
    const { message_id, user_id } = await mk(repo, unknownOp);

    await applyCard(repo, message_id, [], user_id);

    // Саме це раніше кидало помилку й лишало людину без виходу.
    const d = await dismissCard(repo, message_id, user_id);
    expect(d).toEqual({ dismissed: true, already: false });
    expect((await repo.getPending(message_id))?.dismissed_at).toBeTruthy();
  });

  it('картка лишається відкритою: другий тап проходить, а не впирається в «already»', async () => {
    const repo = new InMemoryRepo();
    const { message_id, user_id } = await mk(repo, unknownOp);

    await applyCard(repo, message_id, [], user_id);
    const second = await applyCard(repo, message_id, [], user_id);
    // Не `already: true` — картка не була застосована, отже це не повтор.
    expect(second).toMatchObject({ applied: 0, already: false, undo_token: null });
  });

  it('успішне застосування штампується як і раніше — правка не зачепила робочий шлях', async () => {
    const repo = new InMemoryRepo();
    const card = {
      type: 'profile',
      ops: [{ kind: 'member', op: 'add', label: 'Оксана', diet: 'веганка' }],
    } as unknown as Card;
    const { message_id, user_id } = await mk(repo, card);

    const r = await applyCard(repo, message_id, [], user_id);
    expect(r.applied).toBe(1);
    expect(r.undo_token).toBeTruthy();
    expect((await repo.getPending(message_id))?.applied_at).toBeTruthy();
    await expect(dismissCard(repo, message_id, user_id)).rejects.toThrow('already applied');
  });

  it('картка поля профілю з порожнім текстом — теж не штампується', async () => {
    const repo = new InMemoryRepo();
    const card = { type: 'profile', field: 'name', text: '   ' } as unknown as Card;
    const { message_id, user_id } = await mk(repo, card);

    const r = await applyCard(repo, message_id, [], user_id);
    expect(r.applied).toBe(0);
    expect(r.undo_token).toBeNull();
    expect((await repo.getPending(message_id))?.applied_at).toBeNull();
  });
});
