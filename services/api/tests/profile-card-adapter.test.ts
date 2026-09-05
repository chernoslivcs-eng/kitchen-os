import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

// Раунд 4, крок 4 (a): прапор PROFILE_V2 має лишатись ВІДКАТОМ на проді.
// Промт уже віддає картку поля {field, mode, text}; з вимкненим прапором
// сервер перекладає її в стару ops-картку до applyMode, і та сама відповідь
// моделі застосовується в обох станах без 409.

async function chat(profileV2: boolean, text: string) {
  const repo = new InMemoryRepo();
  const mailer = new ConsoleMailer();
  const app = buildApp(repo, new InMemoryStore(), mailer, { profileV2 });
  await app.ready();
  const me = await signIn(app, mailer, 'me@example.com');
  const s = (await app.inject({ method: 'POST', url: '/v1/session', headers: { cookie: me.cookie }, payload: {} })).json() as { session: { id: string } };
  const res = await app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie }, payload: { session_id: s.session.id, text } });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { card: unknown; card_id: string | null };
  const apply = await app.inject({ method: 'POST', url: `/v1/cards/${body.card_id}/apply`, headers: { cookie: me.cookie }, payload: {} });
  return { repo, me, body, apply };
}

describe('картка поля від моделі під обома станами прапора', () => {
  // Стаб моделі: «профіль no: селери» → {type:'profile', field:'no', mode:'append', text:'селери'}.
  it('PROFILE_V2=1 — картка поля як є, лягає в profile_text', async () => {
    const { repo, me, body, apply } = await chat(true, 'профіль no: селери');
    expect(body.card).toMatchObject({ type: 'profile', field: 'no', text: 'селери' });
    expect(apply.statusCode).toBe(200);
    expect((await repo.getProfileText(me.user_id)).fields.no.text).toBe('селери');
  });

  it('PROFILE_V2=0 — та сама відповідь перекладена в ops-картку й лягає в старий профіль', async () => {
    const { repo, me, body, apply } = await chat(false, 'профіль no: селери');
    expect(body.card).toEqual({ type: 'profile', ops: [{ op: 'add', kind: 'anti', label: 'селери' }] });
    expect(apply.statusCode).toBe(200);
    expect((await repo.getProfile(me.user_id))?.antipatterns).toEqual(['селери']);
    expect((await repo.getProfileText(me.user_id)).fields.no.status).toBe('empty');
  });

  it('PROFILE_V2=0 — ban через кому стає окремими алергіями', async () => {
    const { repo, me, apply } = await chat(false, 'профіль ban: арахіс, селера');
    expect(apply.statusCode).toBe(200);
    expect((await repo.getProfile(me.user_id))?.allergies).toEqual(['арахіс', 'селера']);
  });
});

describe('крок 7 п. 0: «не їм» → поле no незалежно від того, що обрала модель', () => {
  it('стаб віддає meh на «профіль meh: не їм кінзи» — сервер перекладає в no', async () => {
    const { body } = await chat(true, 'профіль meh: не їм кінзи');
    expect(body.card).toMatchObject({ type: 'profile', field: 'no', text: 'не їм кінзи' });
  });
});
