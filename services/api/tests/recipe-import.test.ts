import { describe, it, expect, beforeEach } from 'vitest';
import FormData from 'form-data';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';

// ImportSheet: людина показує сторінку книжки або скрін із телеграму, і рецепт
// має лягти в бібліотеку. Парсер вкладень розпізнавав kind:"recipe" від
// першого дня — і картки з нього не будувалось. Рецепт показувався реплікою
// й зникав назавжди, а eval-фікстура recipe-freeform, яка це перевіряла,
// не могла позеленіти в принципі.

const RECIPE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/eval/fixtures/recipe-freeform.txt',
);

async function uploadRecipe(app: ReturnType<typeof buildApp>, me: Signed) {
  const form = new FormData();
  form.append('file', readFileSync(RECIPE_PATH), {
    filename: 'recipe.txt',
    contentType: 'text/plain',
  });
  return app.inject({
    method: 'POST', url: '/v1/attachments', payload: form,
    headers: { ...form.getHeaders(), cookie: me.cookie },
  });
}

describe('імпорт рецепта з вкладення', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  async function importFlow(me: Signed) {
    const { id } = (await uploadRecipe(app, me)).json();
    const chat = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: me.cookie }, payload: { attachments: [{ id }] },
    });
    return chat;
  }

  it('вкладення з рецептом дає картку рецепта, а не порожню репліку', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const chat = await importFlow(me);
    expect(chat.statusCode).toBe(200);
    const body = chat.json();
    expect(body.card).not.toBeNull();
    expect(body.card.type).toBe('recipe');
    expect(body.card.recipe.t).toContain('Плескавиця');
    expect(body.card_id).toBeTruthy();
  });

  it('застосована картка кладе рецепт у бібліотеку', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const { card_id } = (await importFlow(me)).json();

    const applied = await app.inject({
      method: 'POST', url: `/v1/cards/${card_id}/apply`,
      headers: { cookie: me.cookie }, payload: {},
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().applied).toBe(1);

    const { recipes } = (await app.inject({
      method: 'GET', url: '/v1/recipes', headers: { cookie: me.cookie },
    })).json();
    expect(recipes).toHaveLength(1);
    expect(recipes[0].title).toContain('Плескавиця');
  });

  it('імпортований рецепт відкривається як звичайний — кроки й інгредієнти на місці', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const { card_id } = (await importFlow(me)).json();
    await app.inject({
      method: 'POST', url: `/v1/cards/${card_id}/apply`,
      headers: { cookie: me.cookie }, payload: {},
    });
    const { recipes } = (await app.inject({
      method: 'GET', url: '/v1/recipes', headers: { cookie: me.cookie },
    })).json();
    expect(recipes[0].payload.st.length).toBeGreaterThan(0);
    expect(recipes[0].payload.ing.length).toBeGreaterThan(0);
  });

  it('undo прибирає імпорт із бібліотеки', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const { card_id } = (await importFlow(me)).json();
    const applied = await app.inject({
      method: 'POST', url: `/v1/cards/${card_id}/apply`,
      headers: { cookie: me.cookie }, payload: {},
    });
    const undone = await app.inject({
      method: 'POST', url: `/v1/cards/${card_id}/undo`,
      headers: { cookie: me.cookie },
      payload: { undo_token: applied.json().undo_token },
    });
    expect(undone.statusCode).toBe(200);
    const { recipes } = (await app.inject({
      method: 'GET', url: '/v1/recipes', headers: { cookie: me.cookie },
    })).json();
    expect(recipes).toHaveLength(0);
  });

  it('чужу картку не застосувати', async () => {
    const alice = await signIn(app, mailer, 'alice@example.com');
    const bob = await signIn(app, mailer, 'bob@example.com');
    const { card_id } = (await importFlow(alice)).json();
    const r = await app.inject({
      method: 'POST', url: `/v1/cards/${card_id}/apply`,
      headers: { cookie: bob.cookie }, payload: {},
    });
    expect(r.statusCode).toBe(403);
  });
});
