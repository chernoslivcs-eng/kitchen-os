import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, type PantryBatch } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { randomUUID } from 'node:crypto';

// Бібліотека рецептів — екран 07 із прототипу, якого прод не мав шість
// QA-прогонів. Рецепт народжувався тільки в POST /v1/cook-runs: не приготував —
// зник назавжди.

describe('бібліотека рецептів', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  async function addBatch(household_id: string, label: string, over: Partial<PantryBatch> = {}) {
    const id = randomUUID();
    await repo.insertBatch({
      id, household_id, catalog_key: null, label, zone: 'dry',
      value: 200, unit: 'g', state: 'sealed', opened_at: null, expires_at: null,
      best_before_opened_days: null, added_at: new Date().toISOString(),
      depleted_at: null, confidence: 1, provenance: 'user_statement',
      staple: false, last_by: null, last_action: null, ...over,
    });
    return id;
  }

  const RECIPE = {
    t: 'Паста з пармезаном', tm: 20, sv: 2, d: 'Кремова, проста',
    ing: [{ n: 'спагеті', v: 200, u: 'g' }, { n: 'пармезан', v: 50, u: 'g' }],
    st: [{ t: 'Варити', c: 'Закинути {0}' }],
  };

  it('«лишити на потім» зберігає рецепт і він зʼявляється в списку', async () => {
    const me = await signIn(app, mailer, 'me@example.com');

    const saved = await app.inject({
      method: 'POST', url: '/v1/recipes',
      headers: { cookie: me.cookie }, payload: { recipe: RECIPE },
    });
    expect(saved.statusCode).toBe(201);
    expect(saved.json().id).toBeTruthy();

    const list = await app.inject({ method: 'GET', url: '/v1/recipes', headers: { cookie: me.cookie } });
    expect(list.statusCode).toBe(200);
    const { recipes } = list.json();
    expect(recipes).toHaveLength(1);
    expect(recipes[0].title).toBe('Паста з пармезаном');
    expect(recipes[0].saved_at).toBeTruthy();
  });

  it('статус рахується проти комори: порожня → far', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({
      method: 'POST', url: '/v1/recipes',
      headers: { cookie: me.cookie }, payload: { recipe: RECIPE },
    });
    const { recipes } = (await app.inject({
      method: 'GET', url: '/v1/recipes', headers: { cookie: me.cookie },
    })).json();
    expect(recipes[0].status).toBe('far');
    expect(recipes[0].have).toBe(0);
    expect(recipes[0].total).toBe(2);
    expect(recipes[0].missing).toEqual(['спагеті', 'пармезан']);
  });

  // Головна обіцянка екрана: докупив — рецепт сам переїхав у «можу зараз».
  it('купив усе → той самий рецепт стає ready без жодної дії', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({
      method: 'POST', url: '/v1/recipes',
      headers: { cookie: me.cookie }, payload: { recipe: RECIPE },
    });
    await addBatch(me.household_id, 'Спагеті №5');
    await addBatch(me.household_id, 'Пармезан');

    const { recipes } = (await app.inject({
      method: 'GET', url: '/v1/recipes', headers: { cookie: me.cookie },
    })).json();
    expect(recipes[0].status).toBe('ready');
    expect(recipes[0].missing).toHaveLength(0);
    expect(recipes[0].have).toBe(2);
  });

  it('відкрита партія показується як «рятує»', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({
      method: 'POST', url: '/v1/recipes',
      headers: { cookie: me.cookie }, payload: { recipe: RECIPE },
    });
    await addBatch(me.household_id, 'Спагеті №5');
    await addBatch(me.household_id, 'Пармезан', { state: 'opened' });

    const { recipes } = (await app.inject({
      method: 'GET', url: '/v1/recipes', headers: { cookie: me.cookie },
    })).json();
    expect(recipes[0].rescues).toEqual(['Пармезан']);
  });

  it('приготований рецепт у списку з лічильником, навіть без «на потім»', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({
      method: 'POST', url: '/v1/cook-runs',
      headers: { cookie: me.cookie }, payload: { recipe: RECIPE },
    });
    const { recipes } = (await app.inject({
      method: 'GET', url: '/v1/recipes', headers: { cookie: me.cookie },
    })).json();
    expect(recipes).toHaveLength(1);
    expect(recipes[0].cooked_count).toBe(1);
    expect(recipes[0].saved_at).toBeNull();
  });

  it('скасоване готування не рахується', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const b = await addBatch(me.household_id, 'Спагеті №5');
    const cook = await app.inject({
      method: 'POST', url: '/v1/cook-runs',
      headers: { cookie: me.cookie },
      payload: { recipe: { ...RECIPE, ing: [{ p: b, n: 'спагеті', v: 100, u: 'g' }] } },
    });
    await app.inject({
      method: 'POST', url: `/v1/cook-runs/${cook.json().id}/undo`,
      headers: { cookie: me.cookie }, payload: {},
    });
    const { recipes } = (await app.inject({
      method: 'GET', url: '/v1/recipes', headers: { cookie: me.cookie },
    })).json();
    expect(recipes).toHaveLength(0);
  });

  it('DELETE знімає збереження', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const { id } = (await app.inject({
      method: 'POST', url: '/v1/recipes',
      headers: { cookie: me.cookie }, payload: { recipe: RECIPE },
    })).json();

    const del = await app.inject({ method: 'DELETE', url: `/v1/recipes/${id}`, headers: { cookie: me.cookie } });
    expect(del.statusCode).toBe(204);

    const { recipes } = (await app.inject({
      method: 'GET', url: '/v1/recipes', headers: { cookie: me.cookie },
    })).json();
    expect(recipes).toHaveLength(0);
  });

  it('чужий рецепт не видалити — 403', async () => {
    const alice = await signIn(app, mailer, 'alice@example.com');
    const bob = await signIn(app, mailer, 'bob@example.com');
    const { id } = (await app.inject({
      method: 'POST', url: '/v1/recipes',
      headers: { cookie: alice.cookie }, payload: { recipe: RECIPE },
    })).json();

    const del = await app.inject({ method: 'DELETE', url: `/v1/recipes/${id}`, headers: { cookie: bob.cookie } });
    expect(del.statusCode).toBe(403);
  });

  it('чужі рецепти не видно в списку', async () => {
    const alice = await signIn(app, mailer, 'alice@example.com');
    const bob = await signIn(app, mailer, 'bob@example.com');
    await app.inject({
      method: 'POST', url: '/v1/recipes',
      headers: { cookie: alice.cookie }, payload: { recipe: RECIPE },
    });
    const { recipes } = (await app.inject({
      method: 'GET', url: '/v1/recipes', headers: { cookie: bob.cookie },
    })).json();
    expect(recipes).toHaveLength(0);
  });

  it('без auth — 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/recipes' })).statusCode).toBe(401);
  });

  it('рецепт без назви — 400', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const r = await app.inject({
      method: 'POST', url: '/v1/recipes',
      headers: { cookie: me.cookie }, payload: { recipe: { ing: [] } },
    });
    expect(r.statusCode).toBe(400);
  });
});

// Р-3 варіант A (design-audit-2): рецепт отримує адресу. Згенерований пишеться
// одразу як чернетка (saved_at: null → у бібліотеці не видно), і /recipe/:id
// більше не залежить від router state — F5 перестає бути катастрофою.
describe('адреса рецепта', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('generate персистить чернетку і віддає її id', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const r = await app.inject({
      method: 'POST', url: '/v1/recipes/generate',
      headers: { cookie: me.cookie }, payload: { title: 'Борщ' },
    });
    expect(r.statusCode).toBe(200);
    const { id, recipe } = r.json();
    expect(id).toBeTruthy();
    expect(recipe.t).toBe('Борщ');
    // Чернетка є в базі…
    const row = await repo.getRecipe(id);
    expect(row).not.toBeNull();
    expect(row!.saved_at).toBeNull();
    // …але в бібліотеці не світиться, поки не збережена і не приготована.
    const list = await app.inject({ method: 'GET', url: '/v1/recipes', headers: { cookie: me.cookie } });
    expect(list.json().recipes).toHaveLength(0);
  });

  it('GET /v1/recipes/:id віддає повний payload власнику', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const { id } = (await app.inject({
      method: 'POST', url: '/v1/recipes/generate',
      headers: { cookie: me.cookie }, payload: { title: 'Борщ' },
    })).json();
    const got = await app.inject({ method: 'GET', url: `/v1/recipes/${id}`, headers: { cookie: me.cookie } });
    expect(got.statusCode).toBe(200);
    expect(got.json().recipe.t).toBe('Борщ');
    expect(got.json().saved_at).toBeNull();
  });

  it('чужий рецепт — 404, не 403: не підтверджуємо існування', async () => {
    const alice = await signIn(app, mailer, 'alice@example.com');
    const bob = await signIn(app, mailer, 'bob@example.com');
    const { id } = (await app.inject({
      method: 'POST', url: '/v1/recipes/generate',
      headers: { cookie: alice.cookie }, payload: { title: 'Борщ' },
    })).json();
    expect((await app.inject({
      method: 'GET', url: `/v1/recipes/${id}`, headers: { cookie: bob.cookie },
    })).statusCode).toBe(404);
  });

  it('PATCH /v1/recipes/:id {saved:true} — «на потім» для чернетки з адресою', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const { id } = (await app.inject({
      method: 'POST', url: '/v1/recipes/generate',
      headers: { cookie: me.cookie }, payload: { title: 'Борщ' },
    })).json();
    const patch = await app.inject({
      method: 'PATCH', url: `/v1/recipes/${id}`,
      headers: { cookie: me.cookie }, payload: { saved: true },
    });
    expect(patch.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/v1/recipes', headers: { cookie: me.cookie } });
    expect(list.json().recipes.map((r: { id: string }) => r.id)).toContain(id);
  });
});

// «Рецепт наразі не видається в чаті?» — не видавався: після «Рецепт →»
// розмова не мала сліду, повернувся в стрічку — не знайдеш, що щойно дивився
// (DA2-30). Компроміс із design-audit-2 Р-3: постійний рядок-посилання
// «◇ {назва} · Рецепт →» у стрічці. Генерація з session_id пише в розмову
// повідомлення з карткою recipe_link.
describe('слід рецепта в розмові', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('generate із session_id лишає recipe_link-повідомлення в сесії', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    // сесія дня — з першої репліки
    await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'що приготувати?' },
    });
    const { session } = (await app.inject({
      method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie },
    })).json();

    const gen = await app.inject({
      method: 'POST', url: '/v1/recipes/generate',
      headers: { cookie: me.cookie },
      payload: { title: 'Борщ', session_id: session.id },
    });
    expect(gen.statusCode).toBe(200);
    const { id } = gen.json();

    const { messages } = (await app.inject({
      method: 'GET', url: `/v1/sessions/${session.id}`, headers: { cookie: me.cookie },
    })).json();
    const link = messages.find((m: { card?: { type?: string } }) => m.card?.type === 'recipe_link');
    expect(link).toBeTruthy();
    expect(link.card.recipe_id).toBe(id);
    expect(link.card.title).toBe('Борщ');
  });

  it('без session_id — як раніше, нічого в розмову не пише', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const gen = await app.inject({
      method: 'POST', url: '/v1/recipes/generate',
      headers: { cookie: me.cookie }, payload: { title: 'Борщ' },
    });
    expect(gen.statusCode).toBe(200);
  });

  it('чужий session_id мовчки ігнорується — рецепт генерується без сліду', async () => {
    const alice = await signIn(app, mailer, 'alice@example.com');
    const bob = await signIn(app, mailer, 'bob@example.com');
    await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: alice.cookie },
      payload: { text: 'привіт' },
    });
    const { session } = (await app.inject({
      method: 'GET', url: '/v1/session/today', headers: { cookie: alice.cookie },
    })).json();

    const gen = await app.inject({
      method: 'POST', url: '/v1/recipes/generate',
      headers: { cookie: bob.cookie }, payload: { title: 'Борщ', session_id: session.id },
    });
    expect(gen.statusCode).toBe(200);
    const { messages } = (await app.inject({
      method: 'GET', url: `/v1/sessions/${session.id}`, headers: { cookie: alice.cookie },
    })).json();
    expect(messages.some((m: { card?: { type?: string } }) => m.card?.type === 'recipe_link')).toBe(false);
  });
});

// Скріни Пилипа: два «Бабусин борщ» — з яловичиною на 280 ккал і зі свининою
// на 180. Кожен тап «Рецепт» викликав модель заново, і вона щоразу вигадувала
// інший підхід. Та сама назва в межах доби → той самий рецепт, нуль токенів.
describe('генерація ідемпотентна в межах доби', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  const gen = (cookie: string, title: string, extra: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST', url: '/v1/recipes/generate',
      headers: { cookie }, payload: { title, ...extra },
    });

  it('другий тап по тій самій назві повертає ТОЙ САМИЙ рецепт', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const first = (await gen(me.cookie, 'Бабусин борщ')).json();
    const second = (await gen(me.cookie, 'Бабусин борщ')).json();
    expect(second.id).toBe(first.id);
    expect(second.recipe).toEqual(first.recipe);
    expect(second.reused).toBe(true);
  });

  it('регістр не робить нового рецепта', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const first = (await gen(me.cookie, 'Борщ')).json();
    const second = (await gen(me.cookie, 'борщ')).json();
    expect(second.id).toBe(first.id);
  });

  it('інша назва — інший рецепт', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const first = (await gen(me.cookie, 'Борщ')).json();
    const second = (await gen(me.cookie, 'Різото')).json();
    expect(second.id).not.toBe(first.id);
  });

  it('regenerate: true — свідомий новий підхід', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const first = (await gen(me.cookie, 'Борщ')).json();
    const second = (await gen(me.cookie, 'Борщ', { regenerate: true })).json();
    expect(second.id).not.toBe(first.id);
  });

  it('чужий рецепт із тією ж назвою не перевикористовується', async () => {
    const alice = await signIn(app, mailer, 'alice@example.com');
    const bob = await signIn(app, mailer, 'bob@example.com');
    const a = (await gen(alice.cookie, 'Борщ')).json();
    const b = (await gen(bob.cookie, 'Борщ')).json();
    expect(b.id).not.toBe(a.id);
  });
});

// Рішення Пилипа: рецепт — це хід розмови, а не екран. Повідомлення-слід
// несе ПОВНИЙ рецепт (card.recipe), щоб стрічка рендерила його цілком і
// він переживав F5 як звичайне повідомлення сесії.
describe('рецепт як хід розмови', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('повідомлення в сесії несе повний рецепт, не тільки посилання', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'що приготувати?' },
    });
    const { session } = (await app.inject({
      method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie },
    })).json();

    await app.inject({
      method: 'POST', url: '/v1/recipes/generate',
      headers: { cookie: me.cookie },
      payload: { title: 'Борщ', session_id: session.id },
    });
    const { messages } = (await app.inject({
      method: 'GET', url: `/v1/sessions/${session.id}`, headers: { cookie: me.cookie },
    })).json();
    const msg = messages.find((m: { card?: { type?: string } }) => m.card?.type === 'recipe_link');
    expect(msg.card.recipe).toBeTruthy();
    expect(msg.card.recipe.t).toBe('Борщ');
    expect(msg.card.recipe.st.length).toBeGreaterThan(0);
  });

  it('повторний тап із session_id не плодить друге повідомлення', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'привіт' },
    });
    const { session } = (await app.inject({
      method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie },
    })).json();
    for (let i = 0; i < 2; i++) {
      await app.inject({
        method: 'POST', url: '/v1/recipes/generate',
        headers: { cookie: me.cookie },
        payload: { title: 'Борщ', session_id: session.id },
      });
    }
    const { messages } = (await app.inject({
      method: 'GET', url: `/v1/sessions/${session.id}`, headers: { cookie: me.cookie },
    })).json();
    const links = messages.filter((m: { card?: { type?: string } }) => m.card?.type === 'recipe_link');
    expect(links).toHaveLength(1);
  });
});

// QA8-01: «хвороба двох борщів» повернулась — dedupe порівнював ЗАПИТАНУ
// назву («Паста карбонара з фуетом» із пропозиції) зі збереженою назвою
// МОДЕЛІ («Карбонара з фуетом»). Вони не збігаються майже ніколи. Тепер
// запитана назва пишеться поруч і бере участь у пошуку.
describe('ідемпотентність за запитаною назвою (QA8-01)', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('повтор із назвою пропозиції знаходить рецепт, який модель назвала інакше', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    // Чернетка, де модель «перейменувала» страву: title від моделі,
    // requested_title — те, що просила людина.
    const draft_id = randomUUID();
    await repo.saveRecipe({
      id: draft_id, owner_id: me.user_id, origin: 'generated',
      title: 'Карбонара з фуетом',
      requested_title: 'Паста карбонара з фуетом',
      descr: null, character: null, risk: null, base_servings: 2,
      time_total: null, nutrition: null,
      payload: { t: 'Карбонара з фуетом', ing: [], st: [] },
      created_at: new Date().toISOString(), saved_at: null,
    });

    const second = (await app.inject({
      method: 'POST', url: '/v1/recipes/generate',
      headers: { cookie: me.cookie }, payload: { title: 'Паста карбонара з фуетом' },
    })).json();
    expect(second.id).toBe(draft_id);
    expect(second.reused).toBe(true);
  });

  it('вікно пошуку не обрізає до 20 — 25 рецептів, перший досі знаходиться', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const first = (await app.inject({
      method: 'POST', url: '/v1/recipes/generate',
      headers: { cookie: me.cookie }, payload: { title: 'Нульовий борщ' },
    })).json();
    // Чернетки напряму: 24 генерації впираються в rate-limit, а тест
    // перевіряє вікно пошуку, не ліміт.
    for (let i = 0; i < 24; i++) {
      await repo.saveRecipe({
        id: randomUUID(), owner_id: me.user_id, origin: 'generated',
        title: `Страва ${i}`, requested_title: `Страва ${i}`,
        descr: null, character: null, risk: null, base_servings: 2,
        time_total: null, nutrition: null,
        payload: { t: `Страва ${i}`, ing: [], st: [] },
        created_at: new Date(Date.now() + i).toISOString(), saved_at: null,
      });
    }
    const again = (await app.inject({
      method: 'POST', url: '/v1/recipes/generate',
      headers: { cookie: me.cookie }, payload: { title: 'Нульовий борщ' },
    })).json();
    expect(again.id).toBe(first.id);
    expect(again.reused).toBe(true);
  });

  // QA9-08: «можливості видалити старі рецепти — нема». Рядок «готував, не
  // зберіг» висів у бібліотеці назавжди: DELETE знімав лише saved_at, а
  // HAVING тримав рядок через cooked_count. Тепер DELETE ховає рецепт із
  // бібліотеки (hidden_at), журнал готувань не чіпає.
  it('DELETE прибирає з бібліотеки і рецепт «готував, не зберіг»', async () => {
    const me = await signIn(app, mailer, 'hide@example.com');

    const cook = await app.inject({
      method: 'POST', url: '/v1/cook-runs',
      headers: { cookie: me.cookie },
      payload: {
        recipe: { t: 'Капрезе', tm: 5, sv: 2, ing: [{ n: 'моцарела', v: 100, u: 'g' }], st: [{ t: 'Наріж', c: 'Наріж' }] },
      },
    });
    expect(cook.statusCode).toBe(201);
    const { recipe_id } = cook.json() as { recipe_id: string };

    // У бібліотеці — бо «готував».
    let list = (await app.inject({ method: 'GET', url: '/v1/recipes', headers: { cookie: me.cookie } })).json() as { recipes: { id: string }[] };
    expect(list.recipes.some((r) => r.id === recipe_id)).toBe(true);

    const del = await app.inject({ method: 'DELETE', url: `/v1/recipes/${recipe_id}`, headers: { cookie: me.cookie } });
    expect(del.statusCode).toBe(204);

    list = (await app.inject({ method: 'GET', url: '/v1/recipes', headers: { cookie: me.cookie } })).json() as { recipes: { id: string }[] };
    expect(list.recipes.some((r) => r.id === recipe_id)).toBe(false);

    // Журнал живий: готування нікуди не зникло.
    const runs = (await app.inject({ method: 'GET', url: '/v1/cook-runs', headers: { cookie: me.cookie } })).json() as { runs: { recipe_id?: string }[] };
    expect(runs.runs.length).toBeGreaterThan(0);
  });
});
