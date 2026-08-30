import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, type PantryBatch } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { randomUUID } from 'node:crypto';

// Cook-run: partial vs full deplete, undo restores state, PATCH оновлює rating/verdict/photo.
// Тримаємо все на InMemoryRepo — Postgres шар тестується окремим testcontainers-тестом
// у packages/db.

describe('POST /v1/cook-runs', () => {
  let repo: InMemoryRepo;
  let store: InMemoryStore;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    store = new InMemoryStore();
    mailer = new ConsoleMailer();
    app = buildApp(repo, store, mailer);
    await app.ready();
  });

  async function addBatch(household_id: string, patch: Partial<PantryBatch>): Promise<string> {
    const id = randomUUID();
    await repo.insertBatch({
      id,
      household_id,
      catalog_key: null,
      label: 'моцарела',
      zone: 'fridge',
      value: 250,
      unit: 'g',
      state: 'sealed',
      opened_at: null,
      expires_at: null,
      best_before_opened_days: null,
      added_at: new Date().toISOString(),
      depleted_at: null,
      confidence: 1,
      provenance: 'user_statement',
      staple: false,
      last_by: null,
      last_action: null,
      ...patch,
    });
    return id;
  }

  it('часткова депляція: recipe.ing.v < batch.value → віднімаємо', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const batchId = await addBatch(me.household_id, { value: 250, unit: 'g' });

    const cook = await app.inject({
      method: 'POST', url: '/v1/cook-runs',
      headers: { cookie: me.cookie },
      payload: {
        recipe: {
          t: 'Капрезе', tm: 5, sv: 2,
          ing: [{ p: batchId, n: 'моцарела', v: 100, u: 'g' }],
          st: [{ t: 'Наріж', c: 'Наріж {0}' }],
        },
      },
    });
    expect(cook.statusCode).toBe(201);
    const body = cook.json();
    expect(body.partial).toBe(1);
    expect(body.depleted).toBe(0);

    const batch = await repo.getBatch(batchId);
    expect(batch?.value).toBe(150);
    expect(batch?.state).toBe('opened');
    expect(batch?.opened_at).toBeTruthy();
  });

  it('повна депляція коли recipe.ing.v ≥ batch.value', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const b1 = await addBatch(me.household_id, { value: 200 });

    const cook = await app.inject({
      method: 'POST', url: '/v1/cook-runs',
      headers: { cookie: me.cookie },
      payload: {
        recipe: {
          t: 'Салат', tm: 5, sv: 2,
          ing: [{ p: b1, n: 'моцарела', v: 250, u: 'g' }],
          st: [{ t: 'Готуй', c: 'Змішай' }],
        },
      },
    });
    expect(cook.statusCode).toBe(201);
    const body = cook.json();
    expect(body.depleted).toBe(1);
    expect(body.partial).toBe(0);
    expect((await repo.getBatch(b1))?.state).toBe('depleted');
  });

  // QA4-03: коли модель не дала v/u (або дала «q»:"400g" замість них),
  // раніше депляцували ВСЮ партію. Для пляшки олії й «2 ст.л» це знищувало
  // пляшку. Тепер партія лишається в коморі, лише позначається відкритою.
  it('невідома кількість → партія лишається, тільки opened', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const b1 = await addBatch(me.household_id, { label: 'олія', value: 500, unit: 'ml' });
    const b2 = await addBatch(me.household_id, { label: 'помідор', value: null, unit: null });

    const cook = await app.inject({
      method: 'POST', url: '/v1/cook-runs',
      headers: { cookie: me.cookie },
      payload: {
        recipe: {
          t: 'Салат', tm: 5, sv: 2,
          ing: [
            { p: b1, n: 'олія' },        // без v/u
            { p: b2, n: 'помідор' },     // без v/u і партія без кількості
          ],
          st: [{ t: 'Готуй', c: 'Змішай' }],
        },
      },
    });
    expect(cook.statusCode).toBe(201);
    const body = cook.json();
    expect(body.depleted).toBe(0);
    expect(body.partial).toBe(0);
    expect(body.opened).toBe(2);

    // Обидві партії живі, просто відкриті — юзер сам скоригує у шиті.
    const o1 = await repo.getBatch(b1);
    expect(o1?.state).toBe('opened');
    expect(o1?.value).toBe(500);
    expect((await repo.getBatch(b2))?.state).toBe('opened');
  });

  it('undo повертає стан партії — і для деплеції, і для віднімання', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const b1 = await addBatch(me.household_id, { value: 250, unit: 'g' });
    const b2 = await addBatch(me.household_id, { label: 'песто', value: 100, unit: 'g' });

    const cook = await app.inject({
      method: 'POST', url: '/v1/cook-runs',
      headers: { cookie: me.cookie },
      payload: {
        recipe: {
          t: 'Паста', tm: 15, sv: 2,
          ing: [
            { p: b1, n: 'моцарела', v: 100, u: 'g' }, // партіал
            { p: b2, n: 'песто', v: 100, u: 'g' },    // повна
          ],
          st: [{ t: 'Готуй', c: 'Змішай' }],
        },
      },
    });
    const { id: runId } = cook.json();

    // Перевіряємо, що зміни відбулись
    expect((await repo.getBatch(b1))?.value).toBe(150);
    expect((await repo.getBatch(b2))?.state).toBe('depleted');

    const undo = await app.inject({
      method: 'POST', url: `/v1/cook-runs/${runId}/undo`,
      headers: { cookie: me.cookie }, payload: {},
    });
    expect(undo.statusCode).toBe(200);
    const undoBody = undo.json();
    expect(undoBody.undone).toBe(true);
    expect(undoBody.restored).toBe(2);

    // Стан повернувся
    expect((await repo.getBatch(b1))?.value).toBe(250);
    expect((await repo.getBatch(b1))?.state).toBe('sealed');
    expect((await repo.getBatch(b2))?.state).toBe('sealed');
    expect((await repo.getBatch(b2))?.depleted_at).toBeNull();

    // Повторний undo — 200 з already:true
    const undo2 = await app.inject({
      method: 'POST', url: `/v1/cook-runs/${runId}/undo`,
      headers: { cookie: me.cookie }, payload: {},
    });
    expect(undo2.statusCode).toBe(200);
    expect(undo2.json().already).toBe(true);
  });

  it('чужий cook_run — undo забороняє (403)', async () => {
    const alice = await signIn(app, mailer, 'alice@example.com');
    const bob = await signIn(app, mailer, 'bob@example.com');
    const bId = await addBatch(alice.household_id, {});

    const cook = await app.inject({
      method: 'POST', url: '/v1/cook-runs',
      headers: { cookie: alice.cookie },
      payload: {
        recipe: { t: 'D', tm: 5, sv: 1, ing: [{ p: bId, n: 'a' }], st: [{ t: 't', c: 'c' }] },
      },
    });
    const { id: runId } = cook.json();

    const undoByBob = await app.inject({
      method: 'POST', url: `/v1/cook-runs/${runId}/undo`,
      headers: { cookie: bob.cookie }, payload: {},
    });
    expect(undoByBob.statusCode).toBe(403);
  });

  it('PATCH rating: перевіряє межі 1..5', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const cook = await app.inject({
      method: 'POST', url: '/v1/cook-runs',
      headers: { cookie: me.cookie },
      payload: {
        recipe: { t: 'X', tm: 5, sv: 1, ing: [], st: [{ t: 't', c: 'c' }] },
      },
    });
    const { id } = cook.json();

    const bad = await app.inject({
      method: 'PATCH', url: `/v1/cook-runs/${id}`,
      headers: { cookie: me.cookie }, payload: { rating: 7 },
    });
    expect(bad.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'PATCH', url: `/v1/cook-runs/${id}`,
      headers: { cookie: me.cookie }, payload: { rating: 4, verdict: 'сіль треба менше' },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body.rating).toBe(4);
    expect(body.verdict).toBe('сіль треба менше');

    // photo_url окремим patch — не переклацує rating/verdict
    const photo = await app.inject({
      method: 'PATCH', url: `/v1/cook-runs/${id}`,
      headers: { cookie: me.cookie }, payload: { photo_url: '/v1/attachments/xyz' },
    });
    expect(photo.statusCode).toBe(200);
    const p = photo.json();
    expect(p.rating).toBe(4);
    expect(p.verdict).toBe('сіль треба менше');
    expect(p.photo_url).toBe('/v1/attachments/xyz');
  });
});

describe('GET /v1/r/:id (public)', () => {
  let repo: InMemoryRepo;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    app = buildApp(repo, new InMemoryStore(), new ConsoleMailer());
    await app.ready();
  });

  it('повертає розшарений рецепт без auth', async () => {
    const id = randomUUID();
    await repo.saveRecipe({
      id, owner_id: randomUUID(), origin: 'generated', title: 'Капрезе',
      descr: null, character: null, risk: null, base_servings: 2, time_total: 10,
      nutrition: null, payload: { t: 'Капрезе', tm: 10, sv: 2, ing: [], st: [] },
      created_at: new Date().toISOString(), saved_at: null,
    });
    const res = await app.inject({ method: 'GET', url: `/v1/r/${id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe('Капрезе');
    expect(body.recipe.t).toBe('Капрезе');
  });

  it('невідомий id → 404', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/r/${randomUUID()}` });
    expect(res.statusCode).toBe(404);
  });
});
