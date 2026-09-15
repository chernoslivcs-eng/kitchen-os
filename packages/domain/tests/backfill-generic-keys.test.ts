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
  // 15.09, #139: продукти з gen_*, для яких резолвер тепер дає вид.
  const chips = await mk("чипси Lay's з сиром", 'gen_chips');          // → chips_cheese
  const bread = await mk('хліб', 'gen_bread');                           // виду нема — лишається
  // «перець» у спеціях: з ctx spices резолвер мовчить (овочі там не беруться) —
  // gen-ключ НЕ стирається, бо кращого нема.
  const pepper = await mk('перець', 'gen_bell_pepper');
  const batch = (product_id: string, zone: 'fridge' | 'spices', added_at: string) => repo.insertBatch({ id: randomUUID(), household_id: me.household_id, catalog_key: null, label: 'перець', zone, value: 1, unit: 'pcs', state: 'sealed', opened_at: null, expires_at: null, best_before_opened_days: null, added_at, depleted_at: null, confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: 'add', product_id });
  await batch(pepper, 'fridge', '2026-09-01T00:00:00.000Z');
  await batch(pepper, 'spices', '2026-09-10T00:00:00.000Z');
  return { repo, me, kefir, xyz, milk, cheese, chips, bread, pepper };
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

  // #139: вид після родової голови й зона як контекст. Продукт із gen_*
  // перерішується, коли резолвер тепер дає НЕ-gen ключ; не-gen ключі не чіпаються.
  it('refined: gen_* → вид, з зоною найновішої партії як контекст; не-gen не чіпає', async () => {
    const { repo, me, chips, bread, milk, pepper } = await seed();
    const dry = await backfillGenericKeys(repo, { apply: false });
    expect(dry.refined.map((r) => [r.product, r.from, r.to])).toEqual([["чипси Lay's з сиром", 'gen_chips', 'chips_cheese']]);
    let by = new Map((await repo.listProducts(me.household_id)).map((p) => [p.id, p]));
    expect(by.get(chips)!.catalog_key).toBe('gen_chips'); // сухий прогін

    await backfillGenericKeys(repo, { apply: true });
    by = new Map((await repo.listProducts(me.household_id)).map((p) => [p.id, p]));
    expect(by.get(chips)!.catalog_key).toBe('chips_cheese');
    expect(by.get(bread)!.catalog_key).toBe('gen_bread');
    expect(by.get(pepper)!.catalog_key).toBe('gen_bell_pepper');
    expect(by.get(milk)!.catalog_key).toBe('milk_cow_25');
    const again = await backfillGenericKeys(repo, { apply: true });
    expect(again.refined).toHaveLength(0);
  });
});
