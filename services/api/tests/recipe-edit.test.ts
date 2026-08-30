import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, type PantryBatch, type Recipe, type RecipeLinkCard } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { randomUUID } from 'node:crypto';

// QA-9 (скріни Пилипа, тост з арахісовою пастою):
//   01 — назви інгредієнтів зникали («з комори», «Інгредієнт»), бо рендер
//        резолвив ing.p по живій коморі. Назва має вморожуватись у payload
//        у момент генерації.
//   02 — «поміняй в рецепті багет на батон» ішло в комору (intake_diff),
//        модель брехала «замінив у рецепті». Тепер модель повертає хід
//        recipe_edit, сервер регенерує рецепт і кидає НОВИЙ recipe_link-хід
//        у стрічку. Старе повідомлення не редагується.

describe('QA9: рецепт у розмові', () => {
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

  it('генерація вморожує назви партій у payload (QA9-01)', async () => {
    const me = await signIn(app, mailer, 'labels@example.com');
    const batchId = await addBatch(me.household_id, 'Багет');

    const res = await app.inject({
      method: 'POST', url: '/v1/recipes/generate',
      headers: { cookie: me.cookie }, payload: { title: 'Тост з багетом' },
    });
    expect(res.statusCode).toBe(200);
    const { id, recipe } = res.json() as { id: string; recipe: Recipe };
    const pIng = recipe.ing.find((i) => i.p === batchId);
    expect(pIng, 'стаб має показати пальцем на партію').toBeTruthy();
    expect(pIng!.n).toBe('Багет');

    // і в персистованій чернетці теж
    const row = await repo.getRecipe(id);
    const saved = row!.payload as Recipe;
    expect(saved.ing.find((i) => i.p === batchId)!.n).toBe('Багет');
  });

  it('recipe_edit: новий рецепт-хід у стрічці, старий не чіпається (QA9-02)', async () => {
    const me = await signIn(app, mailer, 'edit@example.com');
    await addBatch(me.household_id, 'Багет');

    // 1. Генеруємо рецепт зі слідом у сесії.
    const chat0 = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: me.cookie }, payload: { text: 'привіт' },
    });
    expect(chat0.statusCode).toBe(200);
    const sessions = await repo.listSessionsForUser(me.user_id);
    const session_id = sessions[0]!.id;

    const gen = await app.inject({
      method: 'POST', url: '/v1/recipes/generate',
      headers: { cookie: me.cookie }, payload: { title: 'Тост з багетом', session_id },
    });
    const { id: originalId } = gen.json() as { id: string };

    // 2. Просимо правку через чат.
    const edit = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: me.cookie },
      payload: { session_id, text: 'поміняй в рецепті «Тост з багетом» багет на батон' },
    });
    expect(edit.statusCode).toBe(200);
    const body = edit.json() as { reply: string; card: RecipeLinkCard | null };

    // Відповідь — НОВИЙ recipe_link, не intake_diff і не recipe_edit.
    expect(body.card?.type).toBe('recipe_link');
    expect(body.card!.recipe_id).not.toBe(originalId);
    expect(body.card!.recipe).toBeTruthy();

    // 3. У сесії зʼявився новий recipe_link-хід, а старий лишився незмінним.
    const messages = await repo.listMessages(session_id);
    const links = messages.filter((m) => m.card?.type === 'recipe_link');
    expect(links.length).toBe(2);
    expect((links[0]!.card as RecipeLinkCard).recipe_id).toBe(originalId);
    expect((links[1]!.card as RecipeLinkCard).recipe_id).toBe(body.card!.recipe_id);

    // 4. Нова чернетка персистована й належить юзеру.
    const row = await repo.getRecipe(body.card!.recipe_id);
    expect(row).toBeTruthy();
    expect(row!.owner_id).toBe(me.user_id);
  });

  it('recipe_edit без знайденого рецепта — чесна відповідь без картки', async () => {
    const me = await signIn(app, mailer, 'edit-miss@example.com');
    const res = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: me.cookie },
      payload: { text: 'поміняй в рецепті «Неіснуючий борщ» сало на гриби' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { reply: string; card: unknown };
    expect(body.card).toBeNull();
    expect(body.reply.toLowerCase()).toContain('не бачу');
  });
});
