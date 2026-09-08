// П4-Т2, авто-шлях. Прапорець auto_applied ставився БЕЗУМОВНО в трьох
// місцях chat.ts — двічі змінною, раз голим літералом. Клієнт по ньому
// вирішує, показувати картку звітом чи кнопками; отже сервер міг сказати
// «не застосовано, токена немає» — і та сама відповідь наказувала стрічці
// картку закрити.
//
// Це не дрібніша половина проблеми, а більша: авто-режим — це чек, список
// покупок і подія, тобто переважна частина живих карток. Ручний шлях
// (Feed.tsx) лишається за періодом, продиктованим рецептом і фото страви.

import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

async function app0() {
  const repo = new InMemoryRepo();
  const mailer = new ConsoleMailer();
  const app = buildApp(repo, new InMemoryStore(), mailer);
  await app.ready();
  const me = await signIn(app, mailer, 'me@example.com');
  return { repo, app, me };
}

describe('авто-застосування звітує факт, а не сам виклик', () => {
  it('«прибери X» на порожньому списку — auto_applied false, токена немає', async () => {
    const { app, me, repo } = await app0();

    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'прибери сіль зі списку' },
    });
    const body = r.json();
    expect(body.card?.type).toBe('shopping');

    // Нічого не сталось: позиції в списку не було.
    expect(await repo.listShoppingItems(me.household_id)).toHaveLength(0);
    // Отже картка не застосована, і закривати її в стрічці не можна.
    expect(body.auto_applied).toBe(false);
    expect(body.undo_token).toBeUndefined();

    // Рядок лишився відкритим — людина може вирішити сама.
    const pc = await repo.getPending(body.card_id);
    expect(pc?.applied_at).toBeNull();
  });

  it('робочий шлях не зачеплено: «додай X» так само auto_applied true з токеном', async () => {
    const { app, me } = await app0();

    const body = (await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'додай сіль у список' },
    })).json();

    expect(body.auto_applied).toBe(true);
    expect(body.undo_token).toBeTruthy();
  });
});
