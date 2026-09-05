import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, kcalOf, type PantryBatch, type Recipe } from '@kitchen/domain';
import { BY_KEY } from '@kitchen/catalog/seed';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { batchNutrition } from '../src/nutrition.js';

// Раунд 5, крок Н1 (§4): БЖВ рецепта рахує сервер з каталогу — штуки через
// вагу одиниці, невідоме пропускається і дає «≈»; комора віддає БЖВ/100 г
// з ознакою оцінки.

async function stand() {
  const repo = new InMemoryRepo();
  const mailer = new ConsoleMailer();
  const app = buildApp(repo, new InMemoryStore(), mailer);
  await app.ready();
  const me = await signIn(app, mailer, 'nutri@example.com');
  return { repo, app, me };
}
const batch = (household_id: string, label: string, over: Partial<PantryBatch> = {}): PantryBatch => ({
  id: randomUUID(), household_id, catalog_key: null, label, zone: 'fridge', value: 500, unit: 'g', state: 'sealed',
  opened_at: null, expires_at: null, best_before_opened_days: null, added_at: new Date().toISOString(),
  depleted_at: null, confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: null, ...over,
} as PantryBatch);

describe('GET /v1/recipes/:id → nutrition_calc', () => {
  it('грами й штуки через каталог; без джерела — ≈ і пропуск', async () => {
    const { repo, app, me } = await stand();
    const fillet = batch(me.household_id, 'Куряче філе', { catalog_key: 'chicken_fillet' });
    await repo.insertBatch(fillet);
    const recipe: Recipe = {
      t: 'Філе з пармезаном', sv: 2, tm: 20, ch: '', d: '', rk: '',
      ing: [{ p: fillet.id, v: 2, u: 'pcs' }, { n: 'пармезан', v: 50, u: 'g' }, { n: 'невідома штука xyz', v: 1, u: 'pcs' }, { n: 'сіль' }],
      st: [{ t: 'Смаж', c: '{0} на пательню' }],
    };
    const id = randomUUID();
    await repo.saveRecipe({ id, owner_id: me.user_id, origin: 'generated', title: recipe.t, descr: null, character: null, risk: null, base_servings: 2, time_total: 20, nutrition: null, payload: recipe, created_at: new Date().toISOString(), saved_at: null });

    const res = await app.inject({ method: 'GET', url: `/v1/recipes/${id}`, headers: { cookie: me.cookie } });
    expect(res.statusCode).toBe(200);
    const calc = (res.json() as { nutrition_calc: { per_serving: { kcal: number; protein: number }; approx: boolean; skipped: number } }).nutrition_calc;
    const chicken = BY_KEY.get('chicken_fillet')!;
    const parm = BY_KEY.get('parmesan')!;
    // 2 шт × 180 г філе + 50 г пармезану, на двох
    const protein = (chicken.nutrition!.protein * 3.6 + parm.nutrition!.protein * 0.5) / 2;
    expect(calc.per_serving.protein).toBe(Math.round(protein * 10) / 10);
    expect(calc.per_serving.kcal).toBe(kcalOf({
      protein, fat: (chicken.nutrition!.fat * 3.6 + parm.nutrition!.fat * 0.5) / 2, carbs: (chicken.nutrition!.carbs * 3.6 + parm.nutrition!.carbs * 0.5) / 2,
    }));
    expect(calc.skipped).toBe(1);      // «невідома штука» — не в каталозі; сіль без кількості не рахується
    expect(calc.approx).toBe(true);
  });

  it('усі інгредієнти з джерелом, без пропусків — без ≈', async () => {
    const { repo, app, me } = await stand();
    const recipe: Recipe = { t: 'Філе', sv: 1, tm: 10, ch: '', d: '', rk: '', ing: [{ n: 'куряче філе', v: 200, u: 'g' }], st: [] };
    const id = randomUUID();
    await repo.saveRecipe({ id, owner_id: me.user_id, origin: 'generated', title: recipe.t, descr: null, character: null, risk: null, base_servings: 1, time_total: 10, nutrition: null, payload: recipe, created_at: new Date().toISOString(), saved_at: null });
    const res = await app.inject({ method: 'GET', url: `/v1/recipes/${id}`, headers: { cookie: me.cookie } });
    const calc = (res.json() as { nutrition_calc: { approx: boolean; skipped: number; per_serving: { kcal: number } } }).nutrition_calc;
    expect(calc.approx).toBe(false);
    expect(calc.skipped).toBe(0);
    expect(calc.per_serving.kcal).toBe(kcalOf({ protein: 22.5 * 2, fat: 2.62 * 2, carbs: 0 }));
  });
});

describe('GET /v1/pantry → nutrition на партії', () => {
  it('kcal/prot/fat/carb на 100 г, est за джерелом; невідомий продукт — null', async () => {
    const { repo, app, me } = await stand();
    await repo.insertBatch(batch(me.household_id, 'Куряче філе', { catalog_key: 'chicken_fillet' }));
    await repo.insertBatch(batch(me.household_id, 'Щось невідоме xyz'));
    const res = await app.inject({ method: 'GET', url: '/v1/pantry', headers: { cookie: me.cookie } });
    const rows = (res.json() as { batches: { label: string; nutrition: { kcal: number; est: boolean } | null }[] }).batches;
    const fillet = rows.find((b) => b.label === 'Куряче філе')!;
    expect(fillet.nutrition).toMatchObject({ kcal: kcalOf({ protein: 22.5, fat: 2.62, carbs: 0 }), prot: 22.5, est: false });
    expect(rows.find((b) => b.label === 'Щось невідоме xyz')!.nutrition).toBeNull();
    expect(batchNutrition({ catalog_key: null, label: 'Куряче філе', product_id: null }, [])?.est).toBe(false);
  });
});
