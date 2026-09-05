import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, createPending, applyCard, undoCard } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { applyVeto } from '../src/veto.js';

// Раунд 4, крок 4: індекс перебудовується при кожному записі в no/ban
// (PATCH, картка, undo), а вето читає індекс.

describe('перебудова veto_index', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('PATCH no → індекс поля у відповіді й у репо; PATCH meh — індекс не чіпає', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const r = await app.inject({ method: 'PATCH', url: '/v1/profile/no', headers: { cookie: me.cookie }, payload: { text: 'мʼяса й птиці' } });
    expect(r.json().veto_index.map((x: { ref: string }) => x.ref)).toEqual(['мʼясо', 'птиця']);
    expect((await repo.getVetoIndex(me.user_id)).map((x) => x.ref)).toEqual(['мʼясо', 'птиця']);

    const meh = await app.inject({ method: 'PATCH', url: '/v1/profile/meh', headers: { cookie: me.cookie }, payload: { text: 'багато мʼяса' } });
    expect(meh.json().veto_index).toEqual([]);
    expect((await repo.getVetoIndex(me.user_id)).map((x) => x.ref)).toEqual(['мʼясо', 'птиця']);

    const ban = await app.inject({ method: 'PATCH', url: '/v1/profile/ban', headers: { cookie: me.cookie }, payload: { text: 'арахіс' } });
    expect(ban.json().veto_index).toEqual([expect.objectContaining({ field: 'ban', ref: 'арахіс', allergy: true })]);
    const none = await app.inject({ method: 'PATCH', url: '/v1/profile/ban', headers: { cookie: me.cookie }, payload: { status: 'none' } });
    expect(none.json().veto_index).toEqual([]);
    expect((await repo.getVetoIndex(me.user_id)).filter((x) => x.field === 'ban')).toEqual([]);
  });

  it('картка поля no → індекс; undo → індекс назад', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await repo.patchProfileField(me.user_id, 'no', { text: 'кінзи' });
    await repo.setVetoIndex(me.user_id, 'no', []);
    const id = randomUUID();
    await createPending(repo, { message_id: id, household_id: me.household_id, user_id: me.user_id, card: { type: 'profile', field: 'no', mode: 'append', text: 'риби' } });
    const r = await applyCard(repo, id, [], me.user_id);
    expect((await repo.getVetoIndex(me.user_id)).map((x) => x.ref)).toEqual(['кінза', 'риба']);
    await undoCard(repo, id, r.undo_token, me.user_id);
    expect((await repo.getVetoIndex(me.user_id)).map((x) => x.ref)).toEqual(['кінза']);
  });
});

describe('applyVeto — обгортка з логом', () => {
  const proposal = () => ({
    type: 'proposal' as const,
    items: [
      { title: 'Стейк рібай', desc: 'Яловичина на грилі', rescues: ['стейк рібай'], needs: [] },
      { title: 'Паста з тунцем', desc: 'Тунець, каперси', rescues: ['тунець'], needs: [] },
    ],
  });

  it('читає індекс: стейк знято, тунець лишився, лог має рядок індексу', () => {
    const repo = new InMemoryRepo();
    const index = [{ user_id: 'u1', field: 'no' as const, kind: 'category' as const, ref: 'мʼясо', label: 'мʼяса', allergy: false, subject: null }];
    const logs: unknown[] = [];
    const call = { card: proposal(), reply: 'Два варіанти.' };
    const r = applyVeto(call, { index, userText: 'що на вечерю', log: (e) => logs.push(e) });
    expect(r.rejected.map((x) => x.title)).toEqual(['Стейк рібай']);
    expect(call.card!.items).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: 'veto', candidate: 'Стейк рібай', row: { field: 'no', kind: 'category', ref: 'мʼясо', label: 'мʼяса' } });
    void repo;
  });
});
