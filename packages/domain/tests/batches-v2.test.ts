// Партії v2 (spec 2026-09-21-shelf-life-v2-design.md, PR 2): злиття add лише при
// тому самому продукті + дні + стані; вагове списується як досі (opened на всю
// партію); штучне при зменшенні лічильника лишається sealed (розділення робить
// buildWriteoffOps в api — тест там).
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
const live = async (repo: InMemoryRepo, h: string) => (await repo.listBatches(h)).filter((b) => b.state !== 'depleted');

describe('(в) злиття add — лише той самий продукт, той самий день, той самий стан', () => {
  it('«молоко 1 л» двічі за день, обидва запечатані → одна партія 2 л, картка вказує на неї', async () => {
    const repo = new InMemoryRepo(); const w = who();
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко', value: 1000, unit: 'ml' }] });
    const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко', value: 1000, unit: 'ml' }] };
    await apply(repo, w, card);
    const bs = await live(repo, w.household_id);
    expect(bs).toHaveLength(1);
    expect(bs[0]!.value).toBe(2000); expect(bs[0]!.unit).toBe('ml');
    expect((card.ops[0] as { batch_id?: string }).batch_id).toBe(bs[0]!.id);
  });
  it('той самий продукт, але відкрите + запечатане → дві партії', async () => {
    const repo = new InMemoryRepo(); const w = who();
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко', value: 1000, unit: 'ml', state: 'opened' }] });
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко', value: 1000, unit: 'ml' }] });
    expect(await live(repo, w.household_id)).toHaveLength(2);
  });
  it('той самий продукт, інший день → дві партії (у кожної свій строк)', async () => {
    const repo = new InMemoryRepo(); const w = who();
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко', value: 1000, unit: 'ml' }] });
    const [old] = await live(repo, w.household_id);
    await repo.updateBatch(old!.id, { added_at: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко', value: 1000, unit: 'ml' }] });
    expect(await live(repo, w.household_id)).toHaveLength(2);
  });
  it('інший продукт (бренд) або інша одиниця → не зливається', async () => {
    const repo = new InMemoryRepo(); const w = who();
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко', value: 1000, unit: 'ml' }] });
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко Галичина', product: 'молоко', brand: 'Галичина', value: 1000, unit: 'ml' }] });
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко', value: 2, unit: 'pcs' }] });
    expect(await live(repo, w.household_id)).toHaveLength(3);
  });
  it('undo злитого add повертає стару кількість, а не видаляє партію', async () => {
    const repo = new InMemoryRepo(); const w = who();
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко', value: 1000, unit: 'ml' }] });
    const message_id = randomUUID();
    await createPending(repo, { message_id, household_id: w.household_id, user_id: w.user_id, card: { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко', value: 1000, unit: 'ml' }] } });
    const r = await applyCard(repo, message_id, [], w.user_id);
    const { undoCard } = await import('../apply.js');
    await undoCard(repo, message_id, r.undo_token!, w.user_id);
    const bs = await live(repo, w.household_id);
    expect(bs).toHaveLength(1); expect(bs[0]!.value).toBe(1000);
  });
});

describe('(б)/(г) correct на запечатаній партії', () => {
  const seed = async (repo: InMemoryRepo, h: string, over: Partial<PantryBatch>) => {
    const id = randomUUID();
    await repo.insertBatch({ id, household_id: h, catalog_key: null, label: 'x', zone: 'fridge', value: 1, unit: 'g', state: 'sealed', opened_at: null, expires_at: null, best_before_opened_days: null, added_at: new Date().toISOString(), depleted_at: null, confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: 'add', product_id: null, ...over });
    return id;
  };
  it('вагове: менше г на sealed → opened на всю партію (як #168)', async () => {
    const repo = new InMemoryRepo(); const w = who();
    const id = await seed(repo, w.household_id, { label: 'сало', value: 1000, unit: 'g' });
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'correct', label: 'сало', batch_id: id, value: 700, unit: 'g' }] });
    const b = await repo.getBatch(id);
    expect(b!.state).toBe('opened'); expect(b!.value).toBe(700);
  });
  it('штучне: 4 шт → 3 шт на sealed — лишається sealed (одиницю відділяє buildWriteoffOps, не тут)', async () => {
    const repo = new InMemoryRepo(); const w = who();
    const id = await seed(repo, w.household_id, { label: 'тунець', value: 4, unit: 'pcs' });
    await apply(repo, w, { type: 'intake_diff', ops: [{ op: 'correct', label: 'тунець', batch_id: id, value: 3, unit: 'pcs' }] });
    const b = await repo.getBatch(id);
    expect(b!.state).toBe('sealed'); expect(b!.opened_at).toBeNull(); expect(b!.value).toBe(3);
  });
});
