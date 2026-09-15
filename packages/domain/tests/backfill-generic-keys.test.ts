import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryRepo } from '../in-memory-repo.js';
import { backfillGenericKeys } from '../backfill-generic-keys.js';
import { signInWithVerifiedEmail } from '../auth.js';

// GENERIC-0915: ключ рішається раз при народженні продукту — наявні продукти
// без ключа новим довідником самі не підхопляться. Разовий бекфіл: лише в
// дірку, тим самим шляхом, що ensureProduct; dry-run без --apply.
async function seed() {
  const repo = new InMemoryRepo();
  const me = await signInWithVerifiedEmail(repo, 'me@x.local', 'Я', null, null);
  const mk = async (product: string, catalog_key: string | null, tags: Record<string, unknown> = {}) => {
    const id = randomUUID();
    await repo.insertProduct({ id, household_id: me.household_id, product, brand: null, variant: null, unit: null, pack_size: null, tags, catalog_key, created_at: new Date().toISOString() } as never);
    return id;
  };
  const kefir = await mk('кефір', null);
  const xyz = await mk('щось xyz', null);
  const milk = await mk('молоко', 'milk_cow_25');            // ключ є — не чіпати
  const cheese = await mk('сир', null, { allergens: ['молочне'], fasting: false }); // теги: allergens лишається, fasting вирівнюється (молочне — скоромне: true)
  return { repo, me, kefir, xyz, milk, cheese };
}

describe('backfillGenericKeys', () => {
  it('dry-run: рахує й нічого не пише', async () => {
    const { repo, me, kefir } = await seed();
    const log = await backfillGenericKeys(repo, { apply: false });
    expect(log.without_key).toBe(3);
    expect(log.filled.map((f) => [f.product, f.key])).toEqual(expect.arrayContaining([['кефір', 'gen_kefir'], ['сир', 'gen_cheese']]));
    expect(log.filled).toHaveLength(2);
    expect(log.left).toBe(1);
    expect(log.applied).toBe(false);
    const p = (await repo.listProducts(me.household_id)).find((x) => x.id === kefir)!;
    expect(p.catalog_key).toBeNull();
  });
  it('--apply: пише ключ ЛИШЕ де знайшовся; теги як в ensureProduct (allergens у дірку, fasting вирівняти)', async () => {
    const { repo, me, kefir, xyz, milk, cheese } = await seed();
    const log = await backfillGenericKeys(repo, { apply: true });
    expect(log.applied).toBe(true);
    const by = new Map((await repo.listProducts(me.household_id)).map((p) => [p.id, p]));
    expect(by.get(kefir)!.catalog_key).toBe('gen_kefir');
    expect(by.get(kefir)!.tags.fasting).toBe(true); // скоромне
    expect(by.get(xyz)!.catalog_key).toBeNull();
    expect(by.get(milk)!.catalog_key).toBe('milk_cow_25');
    expect(by.get(cheese)!.catalog_key).toBe('gen_cheese');
    expect(by.get(cheese)!.tags.allergens).toEqual(['молочне']);
    expect(by.get(cheese)!.tags.fasting).toBe(true);
    // повторний прогін — ідемпотентний
    const again = await backfillGenericKeys(repo, { apply: true });
    expect(again.filled).toHaveLength(0);
    expect(again.without_key).toBe(1);
  });
});
