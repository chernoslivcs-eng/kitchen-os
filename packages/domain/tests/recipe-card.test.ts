import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRepo } from '../in-memory-repo.js';
import { createPending, applyCard, undoCard } from '../apply.js';
import type { RecipeCard } from '../types.js';
import { randomUUID } from 'node:crypto';

// Застосування картки рецепта: людина показала сторінку книжки, побачила
// розібраний рецепт і натиснула «зберегти». До цього кроку картки не було
// взагалі — рецепт із вкладення показувався реплікою й зникав.

const HOUSE = randomUUID();
const USER = randomUUID();

const CARD: RecipeCard = {
  type: 'recipe',
  recipe: {
    t: 'Плескавиця з камбоцолою',
    sv: 2, tm: 40, ch: '40 хвилин', d: 'Соковита', rk: 'Не притискати',
    ing: [{ n: 'фарш', v: 500, u: 'g' }],
    st: [{ t: 'Смажити', c: 'По 4 хв' }],
  },
};

async function apply(repo: InMemoryRepo, card: RecipeCard) {
  const message_id = randomUUID();
  await createPending(repo, { message_id, household_id: HOUSE, user_id: USER, card });
  return { message_id, ...(await applyCard(repo, message_id, [], USER)) };
}

describe('картка рецепта з вкладення', () => {
  let repo: InMemoryRepo;
  beforeEach(() => { repo = new InMemoryRepo(); });

  it('застосування кладе рецепт у бібліотеку', async () => {
    const r = await apply(repo, CARD);
    expect(r.applied).toBe(1);
    const list = await repo.listRecipes(USER);
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('Плескавиця з камбоцолою');
  });

  // origin відрізняє імпорт від згенерованого: те, що людина принесла з
  // книжки, і те, що вигадала модель, — різні речі, і бібліотека має це знати.
  it('позначається як imported, не generated', async () => {
    await apply(repo, CARD);
    const [row] = await repo.listRecipes(USER);
    expect(row!.origin).toBe('imported');
  });

  it('зберігається одразу «на потім» — імпорт це і є намір зберегти', async () => {
    await apply(repo, CARD);
    const [row] = await repo.listRecipes(USER);
    expect(row!.saved_at).toBeTruthy();
  });

  it('повний рецепт лежить у payload, не тільки заголовок', async () => {
    await apply(repo, CARD);
    const [row] = await repo.listRecipes(USER);
    const p = row!.payload as { ing: unknown[]; st: unknown[] };
    expect(p.ing).toHaveLength(1);
    expect(p.st).toHaveLength(1);
  });

  it('undo прибирає рецепт із бібліотеки', async () => {
    const r = await apply(repo, CARD);
    await undoCard(repo, r.message_id, r.undo_token!, USER);
    expect(await repo.listRecipes(USER)).toHaveLength(0);
  });

  it('повторне застосування не дає дубля — мережа мобільна, повтори бувають', async () => {
    const message_id = randomUUID();
    await createPending(repo, { message_id, household_id: HOUSE, user_id: USER, card: CARD });
    const first = await applyCard(repo, message_id, [], USER);
    const second = await applyCard(repo, message_id, [], USER);
    expect(second.already).toBe(true);
    expect(second.undo_token).toBe(first.undo_token);
    expect(await repo.listRecipes(USER)).toHaveLength(1);
  });
});
