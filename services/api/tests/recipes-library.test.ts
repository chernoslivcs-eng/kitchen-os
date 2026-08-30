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
