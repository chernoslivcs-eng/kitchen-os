import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, type Recipe, type RecipeLinkCard } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { randomUUID } from 'node:crypto';

// Правки №10/11: рецепт із бібліотеки/журналу відкривається СЕСІЄЮ в чаті
// (рецепт — хід розмови, не екран). Сесія-близнюк (той самий рецепт, нічого
// більше) реюзається — клік двічі не плодить сміття.

describe('сесія з рецептом', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  async function seedRecipe(owner_id: string, title = 'Борщ'): Promise<string> {
    const id = randomUUID();
    await repo.saveRecipe({
      id, owner_id, origin: 'generated', title, requested_title: title,
      descr: null, character: null, risk: null, base_servings: 2,
      time_total: 60, nutrition: null,
      payload: { t: title, sv: 2, tm: 60, ch: '', d: '', rk: '', ing: [{ n: 'буряк', v: 300, u: 'g' }], st: [{ t: 'Крок', c: '{0}' }] } as Recipe,
      created_at: new Date().toISOString(), saved_at: new Date().toISOString(),
    });
    return id;
  }

  it('POST /v1/session {recipe_id} → нова сесія з recipe_link-ходом і назвою рецепта', async () => {
    const me = await signIn(app, mailer, 's1@example.com');
    const rid = await seedRecipe(me.user_id);

    const res = await app.inject({
      method: 'POST', url: '/v1/session',
      headers: { cookie: me.cookie }, payload: { recipe_id: rid },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { session: { id: string; title: string | null }; messages: { card: RecipeLinkCard | null }[] };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.card?.type).toBe('recipe_link');
    expect(body.messages[0]!.card?.recipe_id).toBe(rid);
    expect(body.messages[0]!.card?.recipe).toBeTruthy();   // повний payload — стрічка рендерить одразу
    expect(body.session.title).toBe('Борщ');
  });

  it('сесія-близнюк реюзається: другий клік по тому ж рецепту не плодить сесію', async () => {
    const me = await signIn(app, mailer, 's2@example.com');
    const rid = await seedRecipe(me.user_id);

    const first = (await app.inject({
      method: 'POST', url: '/v1/session',
      headers: { cookie: me.cookie }, payload: { recipe_id: rid },
    })).json() as { session: { id: string } };
    const second = (await app.inject({
      method: 'POST', url: '/v1/session',
      headers: { cookie: me.cookie }, payload: { recipe_id: rid },
    })).json() as { session: { id: string } };
    expect(second.session.id).toBe(first.session.id);

    // А от коли в сесії вже щось відбулось — вона не близнюк, буде нова.
    await repo.saveMessage({
      id: randomUUID(), session_id: first.session.id, role: 'user',
      text: 'зроби без цибулі', card: null, applied: 0, created_at: new Date().toISOString(),
    });
    const third = (await app.inject({
      method: 'POST', url: '/v1/session',
      headers: { cookie: me.cookie }, payload: { recipe_id: rid },
    })).json() as { session: { id: string } };
    expect(third.session.id).not.toBe(first.session.id);
  });

  it('чужий recipe_id → 404', async () => {
    const me = await signIn(app, mailer, 's3@example.com');
    const other = await signIn(app, mailer, 'other@example.com');
    const rid = await seedRecipe(other.user_id);
    const res = await app.inject({
      method: 'POST', url: '/v1/session',
      headers: { cookie: me.cookie }, payload: { recipe_id: rid },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /v1/recipes/:id/session → сесія, де рецепт живе; немає — null', async () => {
    const me = await signIn(app, mailer, 's4@example.com');
    const rid = await seedRecipe(me.user_id);

    const none = (await app.inject({
      method: 'GET', url: `/v1/recipes/${rid}/session`, headers: { cookie: me.cookie },
    })).json() as { session_id: string | null };
    expect(none.session_id).toBeNull();

    const created = (await app.inject({
      method: 'POST', url: '/v1/session',
      headers: { cookie: me.cookie }, payload: { recipe_id: rid },
    })).json() as { session: { id: string } };

    const found = (await app.inject({
      method: 'GET', url: `/v1/recipes/${rid}/session`, headers: { cookie: me.cookie },
    })).json() as { session_id: string | null };
    expect(found.session_id).toBe(created.session.id);
  });
});
