// Р146: «факт дому» від моделі. Збирач фактів (три джерела; усі порожні —
// моделі не викликаємо), кеш по дню, fallback на помилку, прапорець.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, type PantryBatch, type CookRunRow, type RecipeRow } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { collectHomeFacts } from '../src/routes/home-fact.js';
import type { HomeFactCall } from '../src/model.js';

const live = (text: string | null): HomeFactCall => ({ text, calls: [{ input: 900, output: 40, cached: 0, cache_write: 0 }], meta: { promptVersion: '2026-08-28', model: 'haiku-test', mode: 'live' } });

describe('GET /v1/home-fact', () => {
  let repo: InMemoryRepo; let store: InMemoryStore; let mailer: ConsoleMailer;
  beforeEach(() => { repo = new InMemoryRepo(); store = new InMemoryStore(); mailer = new ConsoleMailer(); });

  function build(opts: { llm?: boolean; generate?: (facts: string) => Promise<HomeFactCall>; background?: boolean }) {
    const app = buildApp(repo, store, mailer, { homeFact: { background: false, ...opts } });
    return app;
  }
  async function batch(household_id: string, patch: Partial<PantryBatch>) {
    await repo.insertBatch({
      id: randomUUID(), household_id, catalog_key: null, label: 'помідори', zone: 'fresh', value: 500, unit: 'g',
      state: 'sealed', opened_at: null, expires_at: null, best_before_opened_days: null,
      added_at: new Date().toISOString(), depleted_at: null, confidence: 1, provenance: 'user_statement',
      staple: false, last_by: null, last_action: null, ...patch,
    });
  }
  const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
  async function cooked(user_id: string, household_id: string, title: string, daysAgo: number, undone = false) {
    const recipe: RecipeRow = { id: randomUUID(), user_id, household_id, title, recipe: { title, servings: 2, ingredients: [], steps: [] }, created_at: new Date().toISOString() } as unknown as RecipeRow;
    await repo.saveRecipe(recipe);
    const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    const run: CookRunRow = { id: randomUUID(), household_id, user_id, recipe_id: recipe.id, servings: 2, started_at: at, finished_at: at, rating: null, verdict: null, photo_url: null, changes: null, undone_at: undone ? at : null };
    await repo.saveCookRun(run);
  }

  it('збирач: горить (≤ 3 дні, прострочене першим), сезон із каталогу, останні страви без undone', async () => {
    const app = build({}); await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    await batch(me.household_id, { label: 'йогурт', expires_at: daysFromNow(2) });
    await batch(me.household_id, { label: 'помідори', expires_at: daysFromNow(-1) });
    await batch(me.household_id, { label: 'рис', zone: 'dry', expires_at: daysFromNow(200) });
    await batch(me.household_id, { label: 'старе молоко', state: 'depleted', depleted_at: new Date().toISOString(), expires_at: daysFromNow(-3) });
    await cooked(me.user_id, me.household_id, 'Борщ', 2);
    await cooked(me.user_id, me.household_id, 'Плов', 5, true);
    await cooked(me.user_id, me.household_id, 'Сирники', 0);
    const { facts, template } = await collectHomeFacts(repo, me.household_id, me.user_id);
    expect(facts.burning.map((b) => b.label)).toEqual(['помідори', 'йогурт']);
    expect(facts.burning[0]!.days).toBeLessThan(0);
    expect(facts.dishes.map((d) => `${d.title}:${d.daysAgo}`)).toEqual(['Сирники:0', 'Борщ:2']);
    for (const s of facts.seasons) expect(typeof s.title).toBe('string');
    expect(template, 'шаблон з бібліотеки, бо є прострочене (не «тихо»)').toMatch(/^Ти зберіг|^Сезон|^Піст/);
  });

  it('усі три списки порожні — моделі не викликаємо, рядка нема', async () => {
    const generate = vi.fn(async () => live('щось'));
    const app = build({ llm: true, generate }); await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    // каталог сезонів у памʼяті може дати активний сезон — вимикаємо всі підписки
    for (const o of await repo.listOccasionCatalog()) await repo.setOccasionSubscription(me.household_id, o.id, false);
    const res = await app.inject({ method: 'GET', url: '/v1/home-fact', headers: { cookie: me.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ text: null, source: null, pending: false });
    expect(generate).not.toHaveBeenCalled();
  });

  it('прапорець вимкнено: лише шаблон, модель не викликається, кеш по дню', async () => {
    const generate = vi.fn(async () => live('щось'));
    const app = build({ llm: false, generate }); await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    await cooked(me.user_id, me.household_id, 'Борщ', 1);
    const a = await app.inject({ method: 'GET', url: '/v1/home-fact', headers: { cookie: me.cookie } });
    expect(a.json()).toMatchObject({ source: 'template', pending: false });
    expect(a.json().text).toContain('приготував 1');
    const b = await app.inject({ method: 'GET', url: '/v1/home-fact', headers: { cookie: me.cookie } });
    expect(b.json()).toEqual(a.json());
    expect(generate).not.toHaveBeenCalled();
    expect((await repo.getHomeFact(me.household_id, a.json().date))?.llm_state).toBe('none');
  });

  it('прапорець увімкнено: перший запит — шаблон + pending, другий — llm; модель один раз; usage записано', async () => {
    const generate = vi.fn(async (facts: string) => { expect(facts).toContain('ОСТАННІ СТРАВИ: Борщ · вчора'); return live('Борщ учора був, сьогодні його черга повторитись.'); });
    const app = build({ llm: true, generate }); await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    await cooked(me.user_id, me.household_id, 'Борщ', 1);
    const a = await app.inject({ method: 'GET', url: '/v1/home-fact', headers: { cookie: me.cookie } });
    expect(a.json()).toMatchObject({ source: 'template', pending: true });
    expect(generate).not.toHaveBeenCalled();
    const b = await app.inject({ method: 'GET', url: '/v1/home-fact', headers: { cookie: me.cookie } });
    expect(b.json()).toMatchObject({ text: 'Борщ учора був, сьогодні його черга повторитись.', source: 'llm', pending: false });
    const c = await app.inject({ method: 'GET', url: '/v1/home-fact', headers: { cookie: me.cookie } });
    expect(c.json()).toEqual(b.json());
    expect(generate).toHaveBeenCalledTimes(1);
    const usage = (await repo.listTokenUsage(me.user_id)).filter((u) => u.call === 'home_fact');
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ profile: 'fast', input_tokens: 900, output_tokens: 40, mode: 'live' });
  });

  it('фон у довгоживучому процесі: другий запит чекає той самий виклик', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const generate = vi.fn(async () => { await gate; return live('Сезон гарбузів у силі.'); });
    const app = build({ llm: true, generate, background: true }); await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    await cooked(me.user_id, me.household_id, 'Борщ', 1);
    const a = await app.inject({ method: 'GET', url: '/v1/home-fact', headers: { cookie: me.cookie } });
    expect(a.json().pending).toBe(true);
    const second = app.inject({ method: 'GET', url: '/v1/home-fact', headers: { cookie: me.cookie } });
    release();
    expect((await second).json()).toMatchObject({ source: 'llm', pending: false });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('помилка або задовга відповідь моделі — лишається шаблон, guard у подіях, того дня спроб більше нема', async () => {
    const generate = vi.fn(async () => { throw new Error('timeout 8000ms'); });
    const app = build({ llm: true, generate }); await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    await cooked(me.user_id, me.household_id, 'Борщ', 1);
    await app.inject({ method: 'GET', url: '/v1/home-fact', headers: { cookie: me.cookie } });
    const b = await app.inject({ method: 'GET', url: '/v1/home-fact', headers: { cookie: me.cookie } });
    expect(b.json()).toMatchObject({ source: 'template', pending: false });
    const c = await app.inject({ method: 'GET', url: '/v1/home-fact', headers: { cookie: me.cookie } });
    expect(c.json()).toEqual(b.json());
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await repo.getHomeFact(me.household_id, b.json().date))?.llm_state).toBe('failed');
    const ev = await repo.listAppEventsForHousehold(me.household_id, { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000), limit: 50 });
    expect(ev.some((e) => e.name === 'incident:home-fact-llm-failed' && (e.props as { kind?: string }).kind === 'guard')).toBe(true);

    // 221+ знаків — теж відкидається
    const long = vi.fn(async () => live('а'.repeat(230)));
    const repo2 = new InMemoryRepo(); repo = repo2;
    const app2 = build({ llm: true, generate: long }); await app2.ready();
    const me2 = await signIn(app2, mailer, 'two@example.com');
    await cooked(me2.user_id, me2.household_id, 'Борщ', 1);
    await app2.inject({ method: 'GET', url: '/v1/home-fact', headers: { cookie: me2.cookie } });
    const d = await app2.inject({ method: 'GET', url: '/v1/home-fact', headers: { cookie: me2.cookie } });
    expect(d.json().source).toBe('template');
  });

  it('стаб (без ключа): тихо лишається шаблон, без guard', async () => {
    const app = build({ llm: true }); await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    await cooked(me.user_id, me.household_id, 'Борщ', 1);
    await app.inject({ method: 'GET', url: '/v1/home-fact', headers: { cookie: me.cookie } });
    const b = await app.inject({ method: 'GET', url: '/v1/home-fact', headers: { cookie: me.cookie } });
    expect(b.json()).toMatchObject({ source: 'template', pending: false });
    const ev = await repo.listAppEventsForHousehold(me.household_id, { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000), limit: 50 });
    expect(ev.some((e) => e.name.startsWith('incident:'))).toBe(false);
  });
});
