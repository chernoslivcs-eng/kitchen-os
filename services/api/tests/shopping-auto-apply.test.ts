// Живий репро 01.09: людина каже «прибери X зі списку», модель відповідає
// минулим часом «Прибрав X», а картка лишається ОЧІКУЄ — список фізично не
// змінюється, поки хтось не тисне «У список». Модель бреше про зроблене
// (card-rules.md вже забороняє це для інших випадків). Пул-8 auto-apply вже
// працює для intake_diff на тій самій підставі: shopping-картка з'являється
// ЛИШЕ на прямий запит людини про покупки (card-rules.md), ніколи як
// пропозиція моделі — тому auto-apply так само безпечний.

import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

describe('чат: shopping-картка застосовується одразу (auto-apply), як intake_diff', () => {
  it('«додай X у список» — список реально поповнюється тим самим ходом', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');

    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'додай сіль у список' },
    });
    const body = r.json();
    expect(body.card?.type).toBe('shopping');
    expect(body.auto_applied).toBe(true);
    expect(body.undo_token).toBeTruthy();

    const items = await repo.listShoppingItems(me.household_id);
    expect(items.map((i) => i.label.toLowerCase())).toContain('сіль');
  });

  it('«прибери X зі списку» після «додай» — реально зникає зі списку, undo повертає', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');

    await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'додай сіль у список' },
    });
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'прибери сіль зі списку' },
    });
    const body = r.json();
    expect(body.auto_applied).toBe(true);
    expect((await repo.listShoppingItems(me.household_id)).map((i) => i.label.toLowerCase()))
      .not.toContain('сіль');

    const undo = await app.inject({
      method: 'POST', url: `/v1/cards/${body.card_id}/undo`, headers: { cookie: me.cookie },
      payload: { undo_token: body.undo_token },
    });
    expect(undo.statusCode).toBe(200);
    expect((await repo.listShoppingItems(me.household_id)).map((i) => i.label.toLowerCase()))
      .toContain('сіль');
  });
});
