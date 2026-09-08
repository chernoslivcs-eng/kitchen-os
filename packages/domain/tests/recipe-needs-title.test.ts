// П4-Т8. Гілка `recipe` в applyCard — єдина з восьми, яка звітувала успіх, не
// перевіривши, чи є що зберігати. `const r = card.recipe` без жодного guard:
// порожня назва давала рецепт-порожнечу в бібліотеці, `applied: 1` і штамп
// «збережено». Людина бачить його в бібліотеці — дефект видимий, не
// внутрішній.
//
// Шлях розбору ВКЛАДЕННЯ від цього захищений давно: parseAttachmentResponse
// має `if (r?.t)` з коментарем «без назви зберігати нічого». Але recipe у
// проді ходить ЧАТОМ (три картки 30.08, усі продиктовані, без вкладень), а
// чатовий шлях повз ту умову проходив.
//
// Тому охорона стоїть у applyCard, а не в розборі: там вона тримає обидва
// шляхи незалежно від того, хто зробив картку.

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

const withTitle = (t: unknown) => ({ type: 'recipe', recipe: { t, ing: [], st: [] } }) as unknown as Card;

describe('рецепт без назви не зберігається і не штампується', () => {
  it('порожня назва — applied 0, бібліотека порожня, картка відкрита', async () => {
    const repo = new InMemoryRepo();
    const { message_id, user_id } = await mk(repo, withTitle(''));

    const r = await applyCard(repo, message_id, [], user_id);
    expect(r.applied).toBe(0);
    expect(r.undo_token).toBeNull();

    expect(await repo.listRecipes(user_id)).toHaveLength(0);
    const pc = await repo.getPending(message_id);
    expect(pc?.applied_at).toBeNull();

    // Наслідок Т2 діє й тут: картка лишається відкритою, «Ні» працює.
    await expect(dismissCard(repo, message_id, user_id)).resolves.toMatchObject({ dismissed: true });
  });

  it('назва з самих пробілів — так само нуль', async () => {
    const repo = new InMemoryRepo();
    const { message_id, user_id } = await mk(repo, withTitle('   '));
    expect((await applyCard(repo, message_id, [], user_id)).applied).toBe(0);
    expect(await repo.listRecipes(user_id)).toHaveLength(0);
  });

  it('назви немає зовсім (модель прислала recipe без t) — не падає, віддає нуль', async () => {
    const repo = new InMemoryRepo();
    const { message_id, user_id } = await mk(repo, { type: 'recipe', recipe: {} } as unknown as Card);
    expect((await applyCard(repo, message_id, [], user_id)).applied).toBe(0);
  });

  it('назва є — зберігається як і раніше, робочий шлях не зачеплено', async () => {
    const repo = new InMemoryRepo();
    const card = { type: 'recipe', recipe: { t: 'Бабусин борщ', ing: [], st: [] } } as unknown as Card;
    const { message_id, user_id } = await mk(repo, card);

    const r = await applyCard(repo, message_id, [], user_id);
    expect(r.applied).toBe(1);
    expect(r.undo_token).toBeTruthy();

    const saved = await repo.listRecipes(user_id);
    expect(saved.map((x) => x.title)).toEqual(['Бабусин борщ']);
    expect((await repo.getPending(message_id))?.applied_at).toBeTruthy();
  });
});
