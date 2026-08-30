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

// #7 з плану 2026-08-30: списання лишається «на око», але позиції, що зникнуть
// з комори ПОВНІСТЮ, людина підтверджує. Кейс власника: відкрив банку, не
// тримався рецепта, щось лишив — а продукт мовчки депляцував усю партію.
// `keep` — id партій, які людина познячила «щось лишилось»: замість depleted
// вони стають opened.
describe('POST /v1/cook-runs · keep: «щось лишилось»', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  async function seed(me: { household_id: string }, label: string, value: number | null) {
    const id = randomUUID();
    await repo.insertBatch({
      id, household_id: me.household_id, catalog_key: null, label, zone: 'fridge',
      value, unit: value != null ? 'g' : null, state: 'sealed', opened_at: null,
      expires_at: null, best_before_opened_days: null, added_at: new Date().toISOString(),
      depleted_at: null, confidence: 1, provenance: 'user_statement',
      staple: false, last_by: null, last_action: null,
    });
    return id;
  }

  it('без keep партія, вжита повністю, депляцується — як і було', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const b = await seed(me, 'Томатна паста', 200);
    await app.inject({
      method: 'POST', url: '/v1/cook-runs', headers: { cookie: me.cookie },
      payload: { recipe: { t: 'Соус', ing: [{ p: b, v: 200, u: 'g' }], st: [] } },
    });
    expect((await repo.getBatch(b))!.state).toBe('depleted');
  });

  it('keep рятує партію: opened замість depleted', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const b = await seed(me, 'Томатна паста', 200);
    const r = await app.inject({
      method: 'POST', url: '/v1/cook-runs', headers: { cookie: me.cookie },
      payload: { recipe: { t: 'Соус', ing: [{ p: b, v: 200, u: 'g' }], st: [] }, keep: [b] },
    });
    expect(r.statusCode).toBe(201);
    const batch = (await repo.getBatch(b))!;
    expect(batch.state).toBe('opened');
    expect(batch.depleted_at).toBeNull();
    // Скільки насправді лишилось — невідомо; чесне «не знаю», не вигадана цифра.
    expect(batch.value).toBeNull();
  });

  it('keep не чіпає часткове списання — воно і так лишає партію', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const b = await seed(me, 'Вершки', 400);
    await app.inject({
      method: 'POST', url: '/v1/cook-runs', headers: { cookie: me.cookie },
      payload: { recipe: { t: 'Соус', ing: [{ p: b, v: 100, u: 'g' }], st: [] }, keep: [b] },
    });
    const batch = (await repo.getBatch(b))!;
    expect(batch.state).toBe('opened');
    expect(batch.value).toBe(300);
  });

  it('undo після keep повертає партію в sealed з кількістю', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const b = await seed(me, 'Томатна паста', 200);
    const run = await app.inject({
      method: 'POST', url: '/v1/cook-runs', headers: { cookie: me.cookie },
      payload: { recipe: { t: 'Соус', ing: [{ p: b, v: 200, u: 'g' }], st: [] }, keep: [b] },
    });
    await app.inject({
      method: 'POST', url: `/v1/cook-runs/${run.json().id}/undo`,
      headers: { cookie: me.cookie }, payload: {},
    });
    const batch = (await repo.getBatch(b))!;
    expect(batch.state).toBe('sealed');
    expect(batch.value).toBe(200);
  });

  it('чужий id у keep ігнорується мовчки', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const b = await seed(me, 'Томатна паста', 200);
    const r = await app.inject({
      method: 'POST', url: '/v1/cook-runs', headers: { cookie: me.cookie },
      payload: {
        recipe: { t: 'Соус', ing: [{ p: b, v: 200, u: 'g' }], st: [] },
        keep: [randomUUID()],
      },
    });
    expect(r.statusCode).toBe(201);
    expect((await repo.getBatch(b))!.state).toBe('depleted');
  });
});

// Модалка «Партія зникне з комори» має знати список ДО списання — і рахувати
// його мусить той самий код, що списує, інакше фронтова копія розійдеться.
describe('POST /v1/cook-runs · dry_run', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  async function seed(me: { household_id: string }, label: string, value: number | null) {
    const id = randomUUID();
    await repo.insertBatch({
      id, household_id: me.household_id, catalog_key: null, label, zone: 'fridge',
      value, unit: value != null ? 'g' : null, state: 'sealed', opened_at: null,
      expires_at: null, best_before_opened_days: null, added_at: new Date().toISOString(),
      depleted_at: null, confidence: 1, provenance: 'user_statement',
      staple: false, last_by: null, last_action: null,
    });
    return id;
  }

  it('віддає, що зникне повністю, і нічого не пише', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const full = await seed(me, 'Томатна паста', 200);   // вжито все → зникне
    const part = await seed(me, 'Вершки', 400);          // частина → лишиться
    const r = await app.inject({
      method: 'POST', url: '/v1/cook-runs', headers: { cookie: me.cookie },
      payload: {
        recipe: { t: 'Соус', ing: [{ p: full, v: 200, u: 'g' }, { p: part, v: 100, u: 'g' }], st: [] },
        dry_run: true,
      },
    });
    expect(r.statusCode).toBe(200);
    const { would_deplete } = r.json();
    expect(would_deplete).toHaveLength(1);
    expect(would_deplete[0].id).toBe(full);
    expect(would_deplete[0].label).toBe('Томатна паста');
    // Нічого не записано і не списано:
    expect((await repo.getBatch(full))!.state).toBe('sealed');
    expect(await repo.listCookRuns(me.user_id)).toHaveLength(0);
  });

  it('порожній прогноз — теж 200 із порожнім списком', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const part = await seed(me, 'Вершки', 400);
    const r = await app.inject({
      method: 'POST', url: '/v1/cook-runs', headers: { cookie: me.cookie },
      payload: { recipe: { t: 'Соус', ing: [{ p: part, v: 100, u: 'g' }], st: [] }, dry_run: true },
    });
    expect(r.json().would_deplete).toEqual([]);
  });
});

// Бриф-2 п.4: знята галочка може нести опційне «лишилось ≈ 100г». Тоді партія
// стає відкритою з ЦИМ значенням, а не з чесним «не знаю».
describe('POST /v1/cook-runs · keep із залишком', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  async function seed(me: { household_id: string }, label: string, value: number) {
    const id = randomUUID();
    await repo.insertBatch({
      id, household_id: me.household_id, catalog_key: null, label, zone: 'fridge',
      value, unit: 'g', state: 'sealed', opened_at: null, expires_at: null,
      best_before_opened_days: null, added_at: new Date().toISOString(),
      depleted_at: null, confidence: 1, provenance: 'user_statement',
      staple: false, last_by: null, last_action: null,
    });
    return id;
  }

  it('keep з v: партія відкрита з указаним залишком', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const b = await seed(me, 'Фета', 200);
    const r = await app.inject({
      method: 'POST', url: '/v1/cook-runs', headers: { cookie: me.cookie },
      payload: {
        recipe: { t: 'Салат', ing: [{ p: b, v: 200, u: 'g' }], st: [] },
        keep: [{ id: b, v: 100 }],
      },
    });
    expect(r.statusCode).toBe(201);
    const batch = (await repo.getBatch(b))!;
    expect(batch.state).toBe('opened');
    expect(batch.value).toBe(100);
  });

  it('старий формат keep: [id] далі працює (value: null)', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const b = await seed(me, 'Фета', 200);
    await app.inject({
      method: 'POST', url: '/v1/cook-runs', headers: { cookie: me.cookie },
      payload: { recipe: { t: 'Салат', ing: [{ p: b, v: 200, u: 'g' }], st: [] }, keep: [b] },
    });
    const batch = (await repo.getBatch(b))!;
    expect(batch.state).toBe('opened');
    expect(batch.value).toBeNull();
  });

  // UX9-26: «Нічого не списувати» все одно списувало — keep-на-всіх відкривав
  // vanish-партії з value:null (вершки втратили «200 мл» назавжди), а часткові
  // віднімання йшли повз модалку взагалі. skip_pantry — справжнє «не чіпати»:
  // журнальний запис є, комора недоторкана.
  it('skip_pantry: жодна партія не змінюється, run створюється', async () => {
    const me = await signIn(app, mailer, 'skip@example.com');
    // partial-кандидат (250 г, рецепт бере 60) і vanish-кандидат (100 г, рецепт бере 800)
    const partialId = await seed(me, 'Пармезан', 250);
    const vanishId = await seed(me, 'Помідори', 100);

    const res = await app.inject({
      method: 'POST', url: '/v1/cook-runs', headers: { cookie: me.cookie },
      payload: {
        recipe: {
          t: 'Паста', sv: 1,
          ing: [{ p: partialId, v: 60, u: 'g' }, { p: vanishId, v: 800, u: 'g' }],
          st: [{ t: 'Крок', c: 'Зробити' }],
        },
        skip_pantry: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; depleted: number; partial: number; opened: number };
    expect(body.depleted).toBe(0);
    expect(body.partial).toBe(0);
    expect(body.opened).toBe(0);

    const partialBatch = (await repo.getBatch(partialId))!;
    expect(partialBatch.value).toBe(250);
    expect(partialBatch.state).toBe('sealed');
    const vanishBatch = (await repo.getBatch(vanishId))!;
    expect(vanishBatch.value).toBe(100);
    expect(vanishBatch.state).toBe('sealed');

    // Журнальний запис живий — оцінку поставити можна.
    const run = await repo.getCookRun(body.id);
    expect(run).toBeTruthy();
    expect(run!.changes).toBeNull();
  });

  // UX9-24: підсумок називає позиції, не «2 позиції» — інакше людина йде
  // в Комору звіряти цифри руками.
  it('відповідь містить назви змінених партій', async () => {
    const me = await signIn(app, mailer, 'labels@example.com');
    const partialId = await seed(me, 'Пармезан', 250);
    const vanishId = await seed(me, 'Помідори', 100);

    const res = await app.inject({
      method: 'POST', url: '/v1/cook-runs', headers: { cookie: me.cookie },
      payload: {
        recipe: {
          t: 'Паста', sv: 1,
          ing: [{ p: partialId, v: 60, u: 'g' }, { p: vanishId, v: 800, u: 'g' }],
          st: [],
        },
      },
    });
    const body = res.json() as { depleted_labels: string[]; partial_labels: string[]; opened_labels: string[] };
    expect(body.partial_labels).toEqual(['Пармезан']);
    expect(body.depleted_labels).toEqual(['Помідори']);
    expect(body.opened_labels).toEqual([]);
  });

  // UX9-11: рецепт зі стрічки вже має рядок (чернетку) — cook-run реюзає його,
  // а не плодить другий. Інакше «У рецепти» дає два однакові рядки в бібліотеці.
  it('recipe_id: реюз чернетки замість другого рядка', async () => {
    const me = await signIn(app, mailer, 'reuse@example.com');
    const draft_id = randomUUID();
    await repo.saveRecipe({
      id: draft_id, owner_id: me.user_id, origin: 'generated',
      title: 'Тост', requested_title: 'Тост', descr: null, character: null,
      risk: null, base_servings: 1, time_total: 5, nutrition: null,
      payload: { t: 'Тост', sv: 1, ing: [{ n: 'багет', v: 60, u: 'g' }], st: [] },
      created_at: new Date().toISOString(), saved_at: null,
    });

    const res = await app.inject({
      method: 'POST', url: '/v1/cook-runs', headers: { cookie: me.cookie },
      payload: {
        recipe: { t: 'Тост', sv: 1, ing: [{ n: 'багет', v: 60, u: 'g' }], st: [] },
        recipe_id: draft_id,
      },
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { recipe_id: string }).recipe_id).toBe(draft_id);

    // Один рядок у бібліотеці (як «готував»), не два.
    const list = (await app.inject({ method: 'GET', url: '/v1/recipes', headers: { cookie: me.cookie } }))
      .json() as { recipes: { id: string }[] };
    expect(list.recipes.filter((r) => r.id === draft_id).length).toBe(1);
    expect(list.recipes.length).toBe(1);
  });

  it('undo повертає початкові кількість і стан', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const b = await seed(me, 'Фета', 200);
    const run = await app.inject({
      method: 'POST', url: '/v1/cook-runs', headers: { cookie: me.cookie },
      payload: {
        recipe: { t: 'Салат', ing: [{ p: b, v: 200, u: 'g' }], st: [] },
        keep: [{ id: b, v: 100 }],
      },
    });
    await app.inject({
      method: 'POST', url: `/v1/cook-runs/${run.json().id}/undo`,
      headers: { cookie: me.cookie }, payload: {},
    });
    const batch = (await repo.getBatch(b))!;
    expect(batch.state).toBe('sealed');
    expect(batch.value).toBe(200);
  });
});
