// PR 4, живий прогін 21.09: «Який обʼєм?» → «190» на партії «1 шт» дав correct v:190 u:g —
// партія стала «190 г», штуки загублено. Тепер: правка в г/мл на штучну партію — це вага
// одиниці (pack на продукт), value/unit партії не чіпаються; «їх 3» — value 3 pcs як досі.
import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { InMemoryRepo } from '../in-memory-repo.js';
import { createPending, applyCard } from '../apply.js';
import type { IntakeCard } from '../types.js';

const who = () => ({ household_id: randomUUID(), user_id: randomUUID() });
async function apply(repo: InMemoryRepo, w: { household_id: string; user_id: string }, card: IntakeCard) {
  const message_id = randomUUID();
  await createPending(repo, { message_id, household_id: w.household_id, user_id: w.user_id, card });
  return applyCard(repo, message_id, [], w.user_id);
}

describe('correct на штучній партії', () => {
  it('«4 шт» + «там по 400» (correct 400 g) → pack 400 g на продукті, партія лишається 4 pcs', async () => {
    const repo = new InMemoryRepo(); const w = who();
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'add', label: 'томати пелаті', product: 'томати пелаті', qty: 4 }] });
    const [b] = await repo.listBatches(w.household_id);
    expect(b).toMatchObject({ value: 4, unit: 'pcs' });
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'correct', label: 'томати пелаті', batch_id: b!.id, value: 400, unit: 'g' }] });
    const after = await repo.getBatch(b!.id);
    expect(after).toMatchObject({ value: 4, unit: 'pcs', state: 'sealed' });
    expect(await repo.getProduct(b!.product_id!)).toMatchObject({ pack_size: 400, pack_unit: 'g' });
  });
  it('явний pack на correct — те саме; «їх 3» (value 3 pcs) — кількість, як досі; мл на партії в pcs → pack ml', async () => {
    const repo = new InMemoryRepo(); const w = who();
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'add', label: 'песто', product: 'песто', qty: 1 }] });
    const [b] = await repo.listBatches(w.household_id);
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'correct', label: 'песто', batch_id: b!.id, pack: { v: 190, u: 'g' } }] });
    expect(await repo.getProduct(b!.product_id!)).toMatchObject({ pack_size: 190, pack_unit: 'g' });
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'correct', label: 'песто', batch_id: b!.id, value: 3, unit: 'pcs' }] });
    expect(await repo.getBatch(b!.id)).toMatchObject({ value: 3, unit: 'pcs' });
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'correct', label: 'песто', batch_id: b!.id, value: 750, unit: 'ml' }] });
    expect(await repo.getBatch(b!.id)).toMatchObject({ value: 3, unit: 'pcs' });
    expect(await repo.getProduct(b!.product_id!)).toMatchObject({ pack_size: 750, pack_unit: 'ml' });
  });
  it('вагова партія: correct у грамах міняє кількість, як досі', async () => {
    const repo = new InMemoryRepo(); const w = who();
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'add', label: 'сало', value: 1000, unit: 'g' }] });
    const [b] = await repo.listBatches(w.household_id);
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'correct', label: 'сало', batch_id: b!.id, value: 700, unit: 'g' }] });
    expect(await repo.getBatch(b!.id)).toMatchObject({ value: 700, unit: 'g' });
  });
});
