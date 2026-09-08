// П4-Т1. Гілка shopping рахувала `chosen.length` — скільки операцій ВИБРАЛИ,
// а не скільки лягло. applyShoppingOp мав два тихі виходи (дубль на `add`,
// відсутня позиція на `remove`) і третій, ще тихіший (позиція без назви).
// Через це картка на шість позицій звітувала «6 позицій» навіть тоді, коли
// в списку не змінилось нічого.
//
// Три наслідки різні, і зливати їх не можна в жоден бік:
//   лягло       — стан змінився;
//   «уже так»   — бажаний стан уже був. Це НЕ промах: сказати «не вийшло»
//                 про річ, яка в списку лежить, означає збрехати навпаки;
//   промах      — ціль не знайдено або позиція без назви.

import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { InMemoryRepo } from '../in-memory-repo.js';
import { createPending, applyCard } from '../apply.js';
import type { Card } from '../types.js';

async function mk(repo: InMemoryRepo, card: Card) {
  const { user_id, household_id } = await repo.createUserWithHousehold('me@example.com', 'me');
  const message_id = randomUUID();
  await createPending(repo, { message_id, household_id, user_id, card });
  return { message_id, user_id, household_id };
}

describe('shopping: картка звітує те, що справді лягло', () => {
  it('нова + уже в списку + remove неіснуючої + без назви → applied 1, already_there 1, missed 2', async () => {
    const repo = new InMemoryRepo();
    const card = {
      type: 'shopping',
      items: [
        { op: 'add', label: 'молоко' },          // нова
        { op: 'add', label: 'олія' },            // вже в списку
        { op: 'remove', label: 'квасоля' },      // такої позиції нема
        { op: 'add' },                           // без назви
      ],
    } as unknown as Card;
    const { message_id, user_id, household_id } = await mk(repo, card);

    // «олія» вже лежить у списку до застосування картки.
    await repo.insertShoppingItem({
      id: randomUUID(), household_id, label: 'олія', reason: null,
      value: null, unit: null, zone: null, checked: false,
      added_by: user_id, source: 'user', created_at: new Date().toISOString(),
    });

    const r = await applyCard(repo, message_id, [], user_id);

    expect(r.applied).toBe(1);
    expect(r.already_there).toBe(1);
    expect(r.missed).toEqual(['remove «квасоля»', 'add «(без назви)»']);

    // Стан: олія не задвоїлась, молоко додалось.
    const items = await repo.listShoppingItems(household_id);
    expect(items.map((i) => i.label).sort()).toEqual(['молоко', 'олія']);
  });

  it('remove існуючої позиції — це лягло, не промах', async () => {
    const repo = new InMemoryRepo();
    const card = { type: 'shopping', items: [{ op: 'remove', label: 'сіль' }] } as unknown as Card;
    const { message_id, user_id, household_id } = await mk(repo, card);
    await repo.insertShoppingItem({
      id: randomUUID(), household_id, label: 'сіль', reason: null,
      value: null, unit: null, zone: null, checked: false,
      added_by: user_id, source: 'user', created_at: new Date().toISOString(),
    });

    const r = await applyCard(repo, message_id, [], user_id);
    expect(r.applied).toBe(1);
    expect(r.missed).toEqual([]);
    expect(await repo.listShoppingItems(household_id)).toHaveLength(0);
  });

  it('message.applied теж несе число, що лягло, а не число вибраних', async () => {
    const repo = new InMemoryRepo();
    const card = {
      type: 'shopping',
      items: [{ op: 'add', label: 'хліб' }, { op: 'remove', label: 'нема такого' }],
    } as unknown as Card;
    const { message_id, user_id } = await mk(repo, card);
    const session = await repo.getOrCreateSessionForDay(user_id, '2026-09-08');
    await repo.saveMessage({
      id: message_id, session_id: session.id, role: 'assistant', text: null,
      card, applied: 0, created_at: new Date().toISOString(),
    });

    await applyCard(repo, message_id, [], user_id);
    const msg = await repo.getMessage(message_id);
    expect(msg?.applied).toBe(1);
  });
});
