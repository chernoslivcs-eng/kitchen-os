// Людина каже «купив мʼясо». Інформації обмаль: ні виду, ні бренду — і
// резолвер каталогу впізнає це лише родовим рівнем. Задум (02.09, розмова
// з власником) — перепитати одразу: «записав; яке саме, щоб потім
// запропонувати вдале?». Людина відповідає «свинина», модель шле rename.
//
// До цієї правки петля не замикалась. `rename` міняв ОДИН рядок:
//   updateBatch(target.id, { label: op.to })
// Партія й далі показувала на продукт дому «мʼясо» з його порожніми тегами:
// без алергенів, без скоромності, без ключа каталогу. Тобто на екрані
// зʼявлялось «свинина», а система під ним знала «мʼясо» — і рецепти
// пропонувала з тим самим знанням, що й до питання. Уточнення виходило
// косметичним, і питати людину було нащо.
//
// Тепер rename переобчислює трійку й продукт тим самим шляхом, що `add`
// (спільний ensureProduct). Перевіряємо не назву, а ЗНАННЯ під нею.

import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { InMemoryRepo } from '../in-memory-repo.js';
import { createPending, applyCard, undoCard } from '../apply.js';
import type { IntakeCard } from '../types.js';

async function applyIntake(repo: InMemoryRepo, ids: { household_id: string; user_id: string }, card: IntakeCard) {
  const message_id = randomUUID();
  await createPending(repo, { message_id, ...ids, card });
  const r = await applyCard(repo, message_id, [], ids.user_id);
  return { message_id, ...r };
}

describe('rename переобчислює продукт, а не тільки рядок на екрані', () => {
  const ids = () => ({ household_id: randomUUID(), user_id: randomUUID() });

  it('«мʼясо» → «свинина»: партія переїжджає на новий продукт дому', async () => {
    const repo = new InMemoryRepo();
    const who = ids();
    await applyIntake(repo, who, {
      type: 'intake_diff',
      ops: [{ op: 'add', label: 'мʼясо', value: 400, unit: 'g' }],
    });
    const before = (await repo.listBatches(who.household_id))[0]!;
    expect(before.label).toBe('мʼясо');
    const genericProductId = before.product_id;
    expect(genericProductId).toBeTruthy();

    await applyIntake(repo, who, {
      type: 'intake_diff',
      ops: [{ op: 'rename', label: 'мʼясо', to: 'свинина' }],
    });

    const after = (await repo.listBatches(who.household_id))[0]!;
    expect(after.id, 'та сама партія, не нова').toBe(before.id);
    expect(after.label).toBe('свинина');
    // Суть правки: показник на продукт змінився. Доти він лишався старим.
    expect(after.product_id, 'продукт має бути ІНШИЙ').not.toBe(genericProductId);
    const prod = await repo.getProduct(after.product_id!);
    expect(prod?.product).toBe('свинина');
  });

  it('новий продукт бере теги з каталогу, а не успадковує порожні', async () => {
    const repo = new InMemoryRepo();
    const who = ids();
    // «сир» родове й беззмістовне для алергенів; «камбоцола» — конкретний
    // блакитний сир, який каталог знає і позначає молочним.
    await applyIntake(repo, who, {
      type: 'intake_diff',
      ops: [{ op: 'add', label: 'сир', value: 200, unit: 'g' }],
    });
    await applyIntake(repo, who, {
      type: 'intake_diff',
      ops: [{ op: 'rename', label: 'сир', to: 'камбоцола' }],
    });

    const batch = (await repo.listBatches(who.household_id))[0]!;
    const prod = await repo.getProduct(batch.product_id!);
    expect(prod?.product).toBe('камбоцола');
    // Ключ каталогу — те, чого при старому rename не зʼявлялось НІКОЛИ.
    expect(prod?.catalog_key, 'каталог має впізнати камбоцолу').toBe('cambozola_cheese');
    expect(prod?.tags.allergens ?? [], 'молочне має проставитись із каталогу').toContain('молоко');
  });

  it('undo повертає і назву, і показник на старий продукт', async () => {
    const repo = new InMemoryRepo();
    const who = ids();
    await applyIntake(repo, who, {
      type: 'intake_diff',
      ops: [{ op: 'add', label: 'мʼясо', value: 400, unit: 'g' }],
    });
    const before = (await repo.listBatches(who.household_id))[0]!;

    const r = await applyIntake(repo, who, {
      type: 'intake_diff',
      ops: [{ op: 'rename', label: 'мʼясо', to: 'свинина' }],
    });
    await undoCard(repo, r.message_id, r.undo_token, who.user_id);

    const back = (await repo.listBatches(who.household_id))[0]!;
    expect(back.label).toBe('мʼясо');
    expect(back.product_id, 'показник відкотився разом із назвою').toBe(before.product_id);
  });

  it('зона НЕ їде за перейменуванням', async () => {
    const repo = new InMemoryRepo();
    const who = ids();
    await applyIntake(repo, who, {
      type: 'intake_diff',
      ops: [{ op: 'add', label: 'мʼясо', value: 400, unit: 'g', zone: 'freezer' }],
    });
    await applyIntake(repo, who, {
      type: 'intake_diff',
      ops: [{ op: 'rename', label: 'мʼясо', to: 'свинина' }],
    });
    const batch = (await repo.listBatches(who.household_id))[0]!;
    // Зона має власну операцію (`correct` із zone). Мовчазний переїзд партії
    // з морозилки в холодильник через перейменування був би сюрпризом,
    // якого людина не просила.
    expect(batch.zone).toBe('freezer');
  });
});
