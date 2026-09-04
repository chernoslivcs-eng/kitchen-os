// Пул-5 №6: «страва обрана → рецепт, не серія діалогів». Живий кейс: юзер
// обрав «Лосось на сковороді», написав «давай» — і отримав ще дві ПРОПОЗИЦІЇ
// поспіль, бо чат умів відповідати лише пропозиціями. Тепер модель маркує
// згоду карткою cook_go {title}, а сервер сам ганяє генератор і повертає
// готовий recipe_link ТИМ САМИМ ходом.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { randomUUID } from 'node:crypto';

describe('чат: cook_go → готовий рецепт одним ходом', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    cookie = (await signIn(app, mailer, 'cook@example.com')).cookie;
  });

  it('згода на страву повертає recipe_link з рецептом, не нову пропозицію', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie },
      payload: { text: 'готуємо «Лосось на сковороді»' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.card?.type).toBe('recipe_link');
    expect(body.card?.recipe?.t).toBeTruthy();
    expect(body.reply).toBeTruthy();
  });

  it('повторна згода на ту саму страву того ж дня — той самий рецепт (дедуп)', async () => {
    const first = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie },
      payload: { text: 'готуємо «Лосось на сковороді»' },
    });
    const second = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie },
      payload: { text: 'готуємо «Лосось на сковороді»' },
    });
    expect(second.json().card?.type).toBe('recipe_link');
    expect(second.json().card?.recipe_id).toBe(first.json().card?.recipe_id);
  });

  // Ручний тест 04.09 (прогін Б): нотатка «менше вершків, лимон» після
  // готування лягла, а «дай рецепт» повернув рецепт із денного кешу — модель
  // обіцяла оновлений, сервер віддав старий. Нотатка новіша за рецепт →
  // дедуп не спрацьовує, генеруємо заново.
  it('нотатка після рецепта скасовує денний дедуп — рецепт генерується заново', async () => {
    const me = await signIn(app, mailer, 'cook2@example.com');
    const first = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'готуємо «Лосось на сковороді»' },
    });
    const firstId = first.json().card?.recipe_id as string;
    expect(firstId).toBeTruthy();
    await repo.insertNote({
      id: randomUUID(), user_id: me.user_id, text: 'менше вершків, лимон у кінці',
      recipe_title: 'Лосось на сковороді', rating: null, pinned: false,
      created_at: new Date(Date.now() + 1000).toISOString(), kind: 'lesson',
    });
    const second = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'готуємо «Лосось на сковороді»' },
    });
    expect(second.json().card?.type).toBe('recipe_link');
    expect(second.json().card?.recipe_id).not.toBe(firstId);
  });

  it('нотатка до ІНШОЇ страви дедуп не чіпає', async () => {
    const me = await signIn(app, mailer, 'cook3@example.com');
    const first = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'готуємо «Лосось на сковороді»' },
    });
    await repo.insertNote({
      id: randomUUID(), user_id: me.user_id, text: 'у борщ — більше буряка',
      recipe_title: 'Борщ', rating: null, pinned: false,
      created_at: new Date(Date.now() + 1000).toISOString(), kind: 'lesson',
    });
    const second = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'готуємо «Лосось на сковороді»' },
    });
    expect(second.json().card?.recipe_id).toBe(first.json().card?.recipe_id);
  });
});
