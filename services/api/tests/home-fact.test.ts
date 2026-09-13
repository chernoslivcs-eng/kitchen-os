// Р146: «факт дому» від моделі — без кешу на сервері. Вхід — ті самі блоки, що в
// чаті; порожні блоки — модель відповідає «—» і рядка нема; fallback на помилку
// або задовгу відповідь; прапорець; usage.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, type PantryBatch, type CookRunRow, type RecipeRow } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { homeFactInput } from '../src/routes/home-fact.js';
import type { HomeFactCall } from '../src/model.js';

const live = (text: string | null): HomeFactCall => ({ text, calls: [{ input: 900, output: 40, cached: 0, cache_write: 0 }], meta: { promptVersion: '2026-08-28', model: 'haiku-test', mode: 'live' } });

describe('GET /v1/home-fact', () => {
  let repo: InMemoryRepo; let store: InMemoryStore; let mailer: ConsoleMailer;
  beforeEach(() => { repo = new InMemoryRepo(); store = new InMemoryStore(); mailer = new ConsoleMailer(); });

  const build = (opts: { llm?: boolean; generate?: (facts: string) => Promise<HomeFactCall> }) => buildApp(repo, store, mailer, { homeFact: opts });
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
  const get = (app: ReturnType<typeof buildApp>, cookie: string) => app.inject({ method: 'GET', url: '/v1/home-fact', headers: { cookie } });

  it('вхід — ті самі блоки, що в чаті: [СЬОГОДНІ] · [ЗАРАЗ] · [КОМОРА] з !Nдн · [ОСТАННІ ГОТУВАННЯ] без undone', async () => {
    const app = build({}); await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    await batch(me.household_id, { label: 'йогурт', expires_at: daysFromNow(2) });
    await batch(me.household_id, { label: 'помідори', expires_at: daysFromNow(-1) });
    await batch(me.household_id, { label: 'старе молоко', state: 'depleted', depleted_at: new Date().toISOString() });
    await cooked(me.user_id, me.household_id, 'Борщ', 2);
    await cooked(me.user_id, me.household_id, 'Плов', 5, true);
    const input = await homeFactInput(repo, me.household_id, me.user_id);
    expect(input).toMatch(/^\[СЬОГОДНІ\] /);
    expect(input).toContain('[ЗАРАЗ]');
    expect(input).toContain('[КОМОРА]');
    expect(input).toMatch(/йогурт[^\n]*!2дн/);
    expect(input).toMatch(/помідори[^\n]*!-1дн/);
    expect(input).not.toContain('старе молоко');
    expect(input).toContain('[ОСТАННІ ГОТУВАННЯ]');
    expect(input).toContain('Борщ');
    expect(input).not.toContain('Плов');
    expect(input, 'без профілю й покупок').not.toMatch(/\[ПРО ЛЮДИНУ\]|\[СПИСОК ПОКУПОК\]/);
  });

  it('прапорець вимкнено: { text: null } без виклику', async () => {
    const generate = vi.fn(async () => live('щось'));
    const app = build({ llm: false, generate }); await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    const res = await get(app, me.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ text: null });
    expect(generate).not.toHaveBeenCalled();
  });

  it('прапорець увімкнено: текст моделі, usage записано з профілем fast', async () => {
    const generate = vi.fn(async (input: string) => { expect(input).toContain('[КОМОРА]'); return live('Борщ позавчора був, сьогодні його черга повторитись.'); });
    const app = build({ llm: true, generate }); await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    await cooked(me.user_id, me.household_id, 'Борщ', 2);
    const res = await get(app, me.cookie);
    expect(res.json()).toEqual({ text: 'Борщ позавчора був, сьогодні його черга повторитись.' });
    expect(generate).toHaveBeenCalledTimes(1);
    const usage = (await repo.listTokenUsage(me.user_id)).filter((u) => u.call === 'home_fact');
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ profile: 'fast', input_tokens: 900, output_tokens: 40, mode: 'live' });
  });

  it('модель каже «—» (нема фактів) — рядка нема, без guard', async () => {
    const app = build({ llm: true, generate: async () => live('—') }); await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    const res = await get(app, me.cookie);
    expect(res.json()).toEqual({ text: null });
    const ev = await repo.listAppEventsForHousehold(me.household_id, { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000), limit: 50 });
    expect(ev.some((e) => e.name.startsWith('incident:'))).toBe(false);
  });

  it('помилка моделі → { text: null } і guard; задовга відповідь без межі речення → теж null', async () => {
    const app = build({ llm: true, generate: async () => { throw new Error('timeout 8000ms'); } }); await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    expect((await get(app, me.cookie)).json()).toEqual({ text: null });
    const ev = await repo.listAppEventsForHousehold(me.household_id, { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000), limit: 50 });
    expect(ev.some((e) => e.name === 'incident:home-fact-llm-failed' && (e.props as { kind?: string }).kind === 'guard')).toBe(true);

    const app2 = build({ llm: true, generate: async () => live('а'.repeat(230)) }); await app2.ready();
    expect((await get(app2, me.cookie)).json()).toEqual({ text: null });
  });

  it('задовга відповідь із межею речення — зріз до 220', async () => {
    const s1 = 'Молоко вже вчора перетнуло межу, кефір живе останній день.';
    const s2 = ' Курка й риба теж мають один день, і хтось із них сьогодні стане обідом.';
    const s3 = ' Сливи й виноград щойно ввійшли в сезон, і вони явно мають намір витіснити з кухні все, що робилось раніше, включно з борщем.';
    const app = build({ llm: true, generate: async () => live(s1 + s2 + s3) }); await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    expect((await get(app, me.cookie)).json()).toEqual({ text: s1 + s2.trimEnd() });
  });

  it('стаб (без ключа): { text: null } без guard', async () => {
    const app = build({ llm: true }); await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');
    expect((await get(app, me.cookie)).json()).toEqual({ text: null });
    const ev = await repo.listAppEventsForHousehold(me.household_id, { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000), limit: 50 });
    expect(ev.some((e) => e.name.startsWith('incident:'))).toBe(false);
  });
});
