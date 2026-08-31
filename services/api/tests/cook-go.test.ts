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
});
