// 19.09 (живий прохід): «коктейль» → correct 700 → 650 мл на джині й лікерах,
// а партії лишились sealed. Частину з запечатаної можна списати, лише
// відкривши її: correct із меншим value на sealed → opened + opened_at, і
// той самий годинник «після відкриття» (expiryOnOpen), що в гілці `open`.
import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { InMemoryRepo } from '../in-memory-repo.js';
import { createPending, applyCard } from '../apply.js';
import type { IntakeCard, PantryBatch } from '../types.js';

const who = () => ({ household_id: randomUUID(), user_id: randomUUID() });
async function apply(repo: InMemoryRepo, w: { household_id: string; user_id: string }, card: IntakeCard) {
  const message_id = randomUUID();
  await createPending(repo, { message_id, household_id: w.household_id, user_id: w.user_id, card });
  return applyCard(repo, message_id, [], w.user_id);
}
async function sealed(repo: InMemoryRepo, household_id: string, over: Partial<PantryBatch> = {}): Promise<string> {
  const id = randomUUID();
  await repo.insertBatch({
    id, household_id, catalog_key: 'gin', label: 'джин', zone: 'dry', value: 700, unit: 'ml', state: 'sealed',
    opened_at: null, expires_at: null, best_before_opened_days: 30, added_at: new Date().toISOString(), depleted_at: null,
    confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: 'add', product_id: null, ...over,
  });
  return id;
}

describe('correct на запечатаній партії', () => {
  it('менше value → opened, opened_at стоїть, годинник «після відкриття» запущено', async () => {
    const repo = new InMemoryRepo(); const w = who();
    const id = await sealed(repo, w.household_id);
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'correct', label: 'джин', value: 650, unit: 'ml' }] });
    const b = (await repo.listBatches(w.household_id)).find((x) => x.id === id)!;
    expect(b.value).toBe(650);
    expect(b.state).toBe('opened');
    expect(b.opened_at).toBeTruthy();
    // best_before_opened_days 30 → expires_at ≈ opened_at + 30 дн (гілка «після відкриття» спрацювала).
    expect(b.expires_at).toBeTruthy();
    const days = (Date.parse(b.expires_at!) - Date.parse(b.opened_at!)) / 86_400_000;
    expect(Math.round(days)).toBe(30);
    expect(b.last_action).toBe('correct');   // це виправлення, не «open»
  });
  it('більше value (доклали) або та сама одиниця не менша — стан не чіпається; add теж', async () => {
    const repo = new InMemoryRepo(); const w = who();
    const id = await sealed(repo, w.household_id);
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'correct', label: 'джин', value: 1000, unit: 'ml' }] });
    expect((await repo.listBatches(w.household_id)).find((x) => x.id === id)!.state).toBe('sealed');
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'add', label: 'лікер', value: 500, unit: 'ml' }] });
    expect((await repo.listBatches(w.household_id)).find((x) => x.label === 'лікер')!.state).toBe('sealed');
  });
  it('вже відкрита — лишається відкритою з тим самим opened_at; явний state:"sealed" важить над правилом', async () => {
    const repo = new InMemoryRepo(); const w = who();
    const opened_at = '2026-09-10T10:00:00.000Z';
    const id = await sealed(repo, w.household_id, { state: 'opened', opened_at });
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'correct', label: 'джин', value: 600, unit: 'ml' }] });
    let b = (await repo.listBatches(w.household_id)).find((x) => x.id === id)!;
    expect(b.opened_at).toBe(opened_at);
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'correct', label: 'джин', value: 500, unit: 'ml', state: 'sealed' }] });
    b = (await repo.listBatches(w.household_id)).find((x) => x.id === id)!;
    expect(b.state).toBe('sealed');
  });
});
