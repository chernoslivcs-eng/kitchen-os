import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server.js';
import { buildDynamicContext } from '../src/model.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

// Крок 8: поле `note` у відповіді моделі → profile_note (source assistant)
// без картки й підтвердження; наступним ходом — у [НОТАТКИ].

async function stand(profileV2 = true) {
  const repo = new InMemoryRepo();
  const mailer = new ConsoleMailer();
  const app = buildApp(repo, new InMemoryStore(), mailer, { profileV2 });
  await app.ready();
  const me = await signIn(app, mailer, 'notes@example.com');
  const s = (await app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie } })).json() as { session: { id: string } };
  const say = (text: string) => app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie }, payload: { session_id: s.session.id, text } });
  return { repo, me, say };
}

describe('нотатка асистента з відповіді моделі', () => {
  it('стаб «нотатка: …» → запис source assistant, без картки; дубль не пишеться', async () => {
    const { repo, me, say } = await stand();
    const r = await say('нотатка: воду на пасту солити менше');
    expect(r.statusCode).toBe(200);
    expect(r.json().card).toBeNull();
    const notes = await repo.listProfileNotes(me.user_id);
    expect(notes.map((n) => [n.text, n.source])).toEqual([['воду на пасту солити менше', 'assistant']]);
    await say('нотатка: Воду на пасту солити менше.');
    expect(await repo.listProfileNotes(me.user_id)).toHaveLength(1);
  });

  it('наступним ходом нотатка стоїть у [НОТАТКИ]', async () => {
    const { repo, me, say } = await stand();
    await say('нотатка: духовка гріє на +20');
    const ctx = buildDynamicContext({
      user_id: me.user_id, session_id: 's', text: 'що на вечерю', pantry: [],
      profileText: await repo.getProfileText(me.user_id), profileNotes: await repo.listProfileNotes(me.user_id),
    });
    expect(ctx).toMatch(/\[НОТАТКИ[^\]]*\]\n\d\d\.\d\d — духовка гріє на \+20/);
  });

  it('збіг із полем профілю — не пишеться; без прапора — нотатки нема', async () => {
    const a = await stand();
    await a.repo.patchProfileField(a.me.user_id, 'no', { text: 'мʼяса, птиці' });
    await a.say('нотатка: мʼяса, птиці');
    expect(await a.repo.listProfileNotes(a.me.user_id)).toEqual([]);

    const b = await stand(false);
    await b.say('нотатка: щось');
    expect(await b.repo.listProfileNotes(b.me.user_id)).toEqual([]);
  });
});
