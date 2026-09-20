import { describe, it, expect, beforeEach } from 'vitest';
import FormData from 'form-data';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';
import { randomUUID } from 'node:crypto';

// #5 з плану 2026-08-30: фото готової страви в чаті. Парсер розпізнає
// kind:"dish" від першого дня — і далі нічого не відбувалось. У прототипі
// фото чіплялось до готування. Тепер: якщо є недавнє готування без фото —
// картка cook_photo; людина тапає, фото лягає в журнал.
// F (20.09): межа свіжості — 60 хв (була доба), маршрут — спершу за наміром
// із підпису: питання про страву йде моделі з фото, а не в шорткат журналу.

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('фото страви → журнал', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  async function uploadPhoto(me: Signed) {
    const form = new FormData();
    form.append('file', PNG, { filename: 'dish.png', contentType: 'image/png' });
    const res = await app.inject({
      method: 'POST', url: '/v1/attachments', payload: form,
      headers: { ...form.getHeaders(), cookie: me.cookie },
    });
    return res.json().id as string;
  }

  async function seedRun(me: Signed, hoursAgo: number, photo_url: string | null = null) {   // hoursAgo — можна дробове (0.17 ≈ 10 хв)
    const recipe_id = randomUUID();
    await repo.saveRecipe({
      id: recipe_id, owner_id: me.user_id, origin: 'generated', title: 'Різото з білими',
      descr: null, character: null, risk: null, base_servings: 2, time_total: null,
      nutrition: null, payload: { t: 'Різото з білими', ing: [], st: [] },
      created_at: new Date().toISOString(), saved_at: null,
    });
    const id = randomUUID();
    const at = new Date(Date.now() - hoursAgo * 3600_000).toISOString();
    await repo.saveCookRun({
      id, household_id: me.household_id, user_id: me.user_id, recipe_id,
      servings: 2, started_at: at, finished_at: at, rating: null, verdict: null,
      photo_url, changes: null, undone_at: null,
    });
    return id;
  }

  it('свіже готування без фото → картка cook_photo', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const run_id = await seedRun(me, 0.17);   // 10 хв тому
    const att = await uploadPhoto(me);
    const chat = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { attachments: [{ id: att }] },
    });
    const body = chat.json();
    expect(body.card).not.toBeNull();
    expect(body.card.type).toBe('cook_photo');
    expect(body.card.run_id).toBe(run_id);
    expect(body.card.recipe_title).toBe('Різото з білими');
  });

  it('apply чіпляє фото до готування, undo знімає', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const run_id = await seedRun(me, 0.17);   // 10 хв тому
    const att = await uploadPhoto(me);
    const { card_id } = (await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { attachments: [{ id: att }] },
    })).json();

    const applied = await app.inject({
      method: 'POST', url: `/v1/cards/${card_id}/apply`,
      headers: { cookie: me.cookie }, payload: {},
    });
    expect(applied.statusCode).toBe(200);
    const run = (await repo.listCookRuns(me.user_id)).find((r) => r.id === run_id)!;
    expect(run.photo_url).toBeTruthy();

    await app.inject({
      method: 'POST', url: `/v1/cards/${card_id}/undo`,
      headers: { cookie: me.cookie },
      payload: { undo_token: applied.json().undo_token },
    });
    const after = (await repo.listCookRuns(me.user_id)).find((r) => r.id === run_id)!;
    expect(after.photo_url).toBeNull();
  });

  it('готування старше 60 хв — без картки, тільки репліка моделі', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await seedRun(me, 3);
    const att = await uploadPhoto(me);
    const body = (await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { attachments: [{ id: att }] },
    })).json();
    expect(body.card).toBeNull();
  });

  it('готування вже з фото — не перезаписуємо мовчки', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await seedRun(me, 0.17, 'blob://existing');
    const att = await uploadPhoto(me);
    const body = (await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { attachments: [{ id: att }] },
    })).json();
    expect(body.card).toBeNull();
  });

  const chatWith = (me: Signed, att: string, text?: string) => app.inject({
    method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
    payload: { attachments: [{ id: att }], ...(text ? { text } : {}) },
  });

  it('F: страва + підпис-питання при готуванні 10 хв тому → відповідь по суті, «Це до «X»?» другим рядком, кнопка cook_photo', async () => {
    const me = await signIn(app, mailer, 'f1@example.com');
    const run_id = await seedRun(me, 0.17);
    const body = (await chatWith(me, await uploadPhoto(me), 'а тісто повинно бути таким густим?')).json();
    expect(body.reply).not.toContain('Гарний вигляд');
    expect(body.reply).toContain('[STUB');                                  // хід моделі, не шорткат
    expect(body.reply).toContain('Це до «Різото з білими»? Прикріпити фото');
    expect(body.card?.type).toBe('cook_photo');
    expect(body.card.run_id).toBe(run_id);
    // репліка людини — раз, не двічі
    const session = (await repo.listSessionsForUser(me.user_id))[0]!;
    const users = (await repo.listMessages(session.id)).filter((m) => m.role === 'user');
    expect(users).toHaveLength(1);
    expect(users[0]!.text).toBe('а тісто повинно бути таким густим?');
  });

  it('F: страва + питання без свіжого готування → лише відповідь моделі, без картки й без «Гарний вигляд»', async () => {
    const me = await signIn(app, mailer, 'f2@example.com');
    await seedRun(me, 3);
    const body = (await chatWith(me, await uploadPhoto(me), 'що не так із соусом?')).json();
    expect(body.reply).toContain('[STUB');
    expect(body.reply).not.toContain('Гарний вигляд');
    expect(body.card).toBeNull();
  });

  it('F: страва + «готово» при готуванні 10 хв тому → шорткат із назвою; 61 хв тому → без пропозиції журналу', async () => {
    const me = await signIn(app, mailer, 'f3@example.com');
    await seedRun(me, 0.17);
    const a = (await chatWith(me, await uploadPhoto(me), 'готово')).json();
    expect(a.reply).toContain('Гарний вигляд. Це «Різото з білими»');
    expect(a.card?.type).toBe('cook_photo');
    const me2 = await signIn(app, mailer, 'f4@example.com');
    await seedRun(me2, 61 / 60);
    const b = (await chatWith(me2, await uploadPhoto(me2), 'готово')).json();
    expect(b.card).toBeNull();
    expect(b.reply).not.toContain('Гарний вигляд');
  });
});
