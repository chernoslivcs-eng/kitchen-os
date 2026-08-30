import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

// session.title існував у схемі від першої міграції й ніколи не заповнювався:
// історія розмов була стовпчиком «дата · час · N повідомлень», і кілька сесій
// за один день не відрізнялись нічим.

describe('назва сесії у проді', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  const chat = (cookie: string, text: string) =>
    app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie }, payload: { text } });

  it('перша репліка дає назву, яку видно в списку сесій', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await chat(me.cookie, 'що приготувати з курки');

    const { sessions } = (await app.inject({
      method: 'GET', url: '/v1/sessions', headers: { cookie: me.cookie },
    })).json();
    expect(sessions[0].title).toBe('Що приготувати з курки');
  });

  // Назву дає перша репліка й більше ніхто — інакше вона стрибала б щоразу.
  it('друга репліка назву не перебиває', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await chat(me.cookie, 'що приготувати з курки');
    await chat(me.cookie, 'а тепер щось із риби');

    const { sessions } = (await app.inject({
      method: 'GET', url: '/v1/sessions', headers: { cookie: me.cookie },
    })).json();
    expect(sessions[0].title).toBe('Що приготувати з курки');
  });

  it('нова сесія отримує власну назву', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await chat(me.cookie, 'борщ з пампушками');

    const fresh = await app.inject({ method: 'POST', url: '/v1/session', headers: { cookie: me.cookie }, payload: {} });
    const fresh_id = fresh.json().session.id;
    await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'хочу різото', session_id: fresh_id },
    });

    const { sessions } = (await app.inject({
      method: 'GET', url: '/v1/sessions', headers: { cookie: me.cookie },
    })).json();
    const titles = sessions.map((s: { title: string | null }) => s.title);
    expect(titles).toContain('Борщ з пампушками');
    expect(titles).toContain('Хочу різото');
  });

  it('порожня сесія лишається без назви — «Без назви» гірше за дату', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const { sessions } = (await app.inject({
      method: 'GET', url: '/v1/sessions', headers: { cookie: me.cookie },
    })).json();
    for (const s of sessions) expect(s.title).toBeNull();
  });
});
