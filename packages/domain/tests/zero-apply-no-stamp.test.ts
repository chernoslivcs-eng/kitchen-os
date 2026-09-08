// П4-Т2. Пʼять гілок applyCard писали applied_at, applied_ops, undo_token і
// кликали markMessageApplied БЕЗУМОВНО — навіть коли не лягло нічого.
// У проді таких штампів на нулі три; людина 7 вересня побачила підтвердження
// запису, якого не було.
//
// Гірше за саму брехню — те, що виходу з неї не було: dismissCard відмовляв
// із «already applied, use undo», бо applied_at уже стояв. Кнопка «Ні»
// переставала працювати саме на тій картці, де вона найпотрібніша.
//
// П5-В4: родина \`profile\`, на якій це ловили, зникла — правило лишилось.
// Носій тепер список покупок: «прибери те, чого в списку немає» так само
// проходить усі гілки й не змінює нічого.

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

// Видалити позицію, якої в списку немає: гілка відпрацьовує, не лягає нічого.
const missesEverything = {
  type: 'shopping',
  items: [{ op: 'remove', label: 'молоко' }],
} as unknown as Card;

describe('нульове застосування картки не штампується', () => {
  it('card_pending не отримує applied_at, applied_ops і undo_token', async () => {
    const repo = new InMemoryRepo();
    const { message_id, user_id } = await mk(repo, missesEverything);

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
    const { message_id, user_id } = await mk(repo, missesEverything);

    await applyCard(repo, message_id, [], user_id);

    // Саме це раніше кидало помилку й лишало людину без виходу.
    const d = await dismissCard(repo, message_id, user_id);
    expect(d).toEqual({ dismissed: true, already: false });
    expect((await repo.getPending(message_id))?.dismissed_at).toBeTruthy();
  });

  it('картка лишається відкритою: другий тап проходить, а не впирається в «already»', async () => {
    const repo = new InMemoryRepo();
    const { message_id, user_id } = await mk(repo, missesEverything);

    await applyCard(repo, message_id, [], user_id);
    const second = await applyCard(repo, message_id, [], user_id);
    // Не \`already: true\` — картка не була застосована, отже це не повтор.
    expect(second).toMatchObject({ applied: 0, already: false, undo_token: null });
  });

  it('успішне застосування штампується як і раніше — правка не зачепила робочий шлях', async () => {
    const repo = new InMemoryRepo();
    const card = { type: 'shopping', items: [{ op: 'add', label: 'молоко' }] } as unknown as Card;
    const { message_id, user_id } = await mk(repo, card);

    const r = await applyCard(repo, message_id, [], user_id);
    expect(r.applied).toBe(1);
    expect(r.undo_token).toBeTruthy();
    expect((await repo.getPending(message_id))?.applied_at).toBeTruthy();
    await expect(dismissCard(repo, message_id, user_id)).rejects.toThrow('already applied');
  });

  // П5-В4: картка родини, яку код більше не знає (у проді такі лежать —
  // П4 і П5 їдуть одним деплоєм). Замість рядка розробника — чесний нуль.
  it('картка знятої родини profile — нуль, а не «apply not implemented»', async () => {
    const repo = new InMemoryRepo();
    const stale = { type: 'profile', field: 'no', mode: 'append', text: 'селери' } as unknown as Card;
    const { message_id, user_id } = await mk(repo, stale);

    const r = await applyCard(repo, message_id, [], user_id);
    expect(r.applied).toBe(0);
    expect(r.undo_token).toBeNull();
    expect((await repo.getPending(message_id))?.applied_at).toBeNull();
    expect(await dismissCard(repo, message_id, user_id)).toEqual({ dismissed: true, already: false });
  });
});
