// Крок А1: ціна прив'язується до ходу.
//
// Досі pulse.ts зшивав token_usage з повідомленням здогадкою — найближчий
// виклик тієї самої людини в межах хвилини. Уся юніт-економіка стояла на цій
// здогадці, і побачити її помилку було нічим.
//
// Тут перевіряється рівно дві речі й межа між ними: у чаті виклик знає СВІЙ
// хід; поза чатом він чесно каже «не знаю» — і не падає через це.

import { describe, it, expect, beforeEach } from 'vitest';
import FormData from 'form-data';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';

describe('token_usage: привʼязка до ходу', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let me: Signed;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    me = await signIn(app, mailer, 'turn@example.com');
  });

  const chat = (text: string) => app.inject({
    method: 'POST', url: '/v1/chat',
    headers: { cookie: me.cookie },
    payload: { session_id: 's', text },
  });

  it('виклик у чаті вказує на ПОВІДОМЛЕННЯ ЛЮДИНИ, яке його спричинило', async () => {
    const res = await chat('привіт');
    expect(res.statusCode).toBe(200);

    const rows = await repo.listTokenUsage(me.user_id);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    expect(row.session_id).toBeTruthy();
    expect(row.message_id).toBeTruthy();

    // Указівник не просто «щось непорожнє»: він мусить знайти реальний хід
    // людини в тій самій сесії. Прив'язка до чужого рядка була б гіршою за
    // порожню — вона виглядала б як факт.
    const messages = await repo.listMessages(row.session_id!);
    const target = messages.find((m) => m.id === row.message_id);
    expect(target).toBeTruthy();
    expect(target!.role).toBe('user');
    expect(target!.text).toBe('привіт');
  });

  it('два ходи — два різні указівники, а не один на обидва', async () => {
    await chat('перший');
    await chat('другий');
    const rows = await repo.listTokenUsage(me.user_id);
    expect(rows).toHaveLength(2);
    const ids = new Set(rows.map((r) => r.message_id));
    expect(ids.size).toBe(2);
    expect([...ids].every(Boolean)).toBe(true);
  });

  it('виклик ПОЗА чатом пише null і не падає', async () => {
    // Розбір вкладення з підказкою: модель викликається без жодного ходу —
    // повідомлення ще не існує. Вигадувати йому «найближче» ми не будемо.
    const form = new FormData();
    form.append('file', Buffer.from('Молоко 2 шт\nХліб 1 шт\n'), {
      filename: 'receipt.txt', contentType: 'text/plain',
    });
    const up = await app.inject({
      method: 'POST', url: '/v1/attachments',
      payload: form, headers: { ...form.getHeaders(), cookie: me.cookie },
    });
    expect(up.statusCode).toBe(200);

    const res = await app.inject({
      method: 'POST', url: `/v1/attachments/${up.json().id}/reparse`,
      headers: { cookie: me.cookie },
      payload: { hint: 'це чек' },
    });
    expect(res.statusCode).toBe(200);

    const rows = await repo.listTokenUsage(me.user_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.call).toBe('attachment_parse');
    expect(rows[0]!.message_id).toBeNull();
    expect(rows[0]!.session_id).toBeNull();
  });

  it('генерація рецепта поза чатом — теж без привʼязки', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/recipes/generate',
      headers: { cookie: me.cookie },
      payload: { title: 'сирники' },
    });
    expect(res.statusCode).toBe(200);
    const rows = (await repo.listTokenUsage(me.user_id)).filter((r) => r.call === 'recipe_gen');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.message_id === null && r.session_id === null)).toBe(true);
  });
});
