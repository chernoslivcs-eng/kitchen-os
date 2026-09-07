// Крок П3: профіль пише людина, не продукт.
//
// Тут перевіряється межа: картка, якою продукт писав у профіль за людину,
// більше не доходить ні до бази, ні до стрічки — а історична, що вже лежить у
// проді, читається без падінь і без «undefined».

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: createMock }; },
}));

const { buildApp } = await import('../src/server.js');
const { InMemoryRepo } = await import('@kitchen/domain');
const { cardFormError } = await import('@kitchen/domain');
const { InMemoryStore } = await import('../src/attachment-store.js');
const { ConsoleMailer } = await import('../src/mailer.js');
const { signIn } = await import('./helpers.js');

function resp(text: string) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    stop_reason: 'end_turn',
  };
}

describe('cardFormError — які форми продукт уміє виконати', () => {
  it('картка поля профілю відхиляється: цієї форми більше немає', () => {
    expect(cardFormError({ type: 'profile', field: 'ban', mode: 'append', text: 'фундук' } as never))
      .toBe('profile:field-form-retired');
  });

  it('вигадана форма з опами {op, field, text} — теж', () => {
    // Саме вона й потрапила в прод: три порожні прочерки в стрічці.
    expect(cardFormError({ type: 'profile', ops: [{ op: 'add', field: 'ban', text: 'фундук' }] } as never))
      .toBe('profile:op-not-member');
  });

  it('домашні проходять — це не профіль людини, це їдці', () => {
    expect(cardFormError({ type: 'profile', ops: [{ op: 'add', kind: 'member', label: 'Оля' }] } as never))
      .toBeNull();
  });

  it('порожні ops не проходять: застосовувати нема чого', () => {
    expect(cardFormError({ type: 'profile', ops: [] } as never)).toBe('profile:no-ops');
    expect(cardFormError({ type: 'intake_diff', ops: [] } as never)).toBe('intake_diff:no-ops');
    expect(cardFormError({ type: 'shopping', items: [] } as never)).toBe('shopping:no-items');
  });

  it('здорові картки не чіпає', () => {
    expect(cardFormError({ type: 'intake_diff', ops: [{ op: 'add', label: 'хліб' }] } as never)).toBeNull();
    expect(cardFormError({ type: 'proposal', items: [{ title: 'Паста' }] } as never)).toBeNull();
    expect(cardFormError(null)).toBeNull();
  });
});

describe('межа: картка невідомої форми не доходить до бази', () => {
  let repo: InstanceType<typeof InMemoryRepo>;
  let mailer: InstanceType<typeof ConsoleMailer>;
  let app: ReturnType<typeof buildApp>;
  const OLD = { ...process.env };

  beforeEach(async () => {
    createMock.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    delete process.env.OPENROUTER_API_KEY;
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });
  afterEach(() => { process.env = { ...OLD }; });

  const chat = async (cookie: string, session_id: string, text: string) =>
    app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie }, payload: { session_id, text } });

  it('модель віддала картку поля профілю → картки в стрічці немає, репліка лишилась', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const s = (await app.inject({ method: 'POST', url: '/v1/session', headers: { cookie: me.cookie }, payload: {} })).json() as { session: { id: string } };
    createMock.mockResolvedValueOnce(resp(JSON.stringify({
      reply: 'Запишу в профіль.',
      card: { type: 'profile', field: 'ban', mode: 'append', text: 'лактозу' },
    })));

    const r = await chat(me.cookie, s.session.id, 'мені не можна лактозу');
    expect(r.statusCode).toBe(200);
    const body = r.json() as { reply: string; card: unknown; card_id: string | null };
    // Репліку віддаємо: вона адресована людині, і мовчати замість неї гірше.
    expect(body.reply).toBe('Запишу в профіль.');
    expect(body.card).toBeNull();
    expect(body.card_id).toBeNull();
    // І профіль лишився недоторканим — продукт у нього не пише.
    expect((await repo.getProfileText(me.user_id)).fields.ban.status).toBe('empty');
  });

  it('модель віддала домашніх → картка проходить, як і була', async () => {
    const me = await signIn(app, mailer, 'me2@example.com');
    const s = (await app.inject({ method: 'POST', url: '/v1/session', headers: { cookie: me.cookie }, payload: {} })).json() as { session: { id: string } };
    createMock.mockResolvedValueOnce(resp(JSON.stringify({
      reply: 'Записав Олю.',
      card: { type: 'profile', ops: [{ op: 'add', kind: 'member', label: 'Оля' }] },
    })));
    const r = await chat(me.cookie, s.session.id, 'зі мною живе Оля');
    const body = r.json() as { card: { type: string } | null; card_id: string | null };
    expect(body.card?.type).toBe('profile');
    expect(body.card_id).toBeTruthy();
  });

  it('«свідомо сказала про себе» приходить вказівником profile_focus, а не записом', async () => {
    const me = await signIn(app, mailer, 'me3@example.com');
    const s = (await app.inject({ method: 'POST', url: '/v1/session', headers: { cookie: me.cookie }, payload: {} })).json() as { session: { id: string } };
    createMock.mockResolvedValueOnce(resp(JSON.stringify({
      reply: 'Це має бути в профілі.',
      profile_focus: 'ban',
    })));
    const r = await chat(me.cookie, s.session.id, 'мені не можна лактозу');
    const body = r.json() as { profile_focus: string | null; card: unknown };
    expect(body.profile_focus).toBe('ban');
    expect(body.card).toBeNull();
    // Вказівник — не запис: поле лишилось порожнім.
    expect((await repo.getProfileText(me.user_id)).fields.ban.status).toBe('empty');
  });

  it('вигаданий ключ у profile_focus не проходить — панель не відкриється навмання', async () => {
    const me = await signIn(app, mailer, 'me4@example.com');
    const s = (await app.inject({ method: 'POST', url: '/v1/session', headers: { cookie: me.cookie }, payload: {} })).json() as { session: { id: string } };
    createMock.mockResolvedValueOnce(resp(JSON.stringify({ reply: 'Ок.', profile_focus: 'улюблений_колір' })));
    const r = await chat(me.cookie, s.session.id, 'мені не можна лактозу');
    expect((r.json() as { profile_focus: string | null }).profile_focus).toBeNull();
  });

  it('«почув мимохідь» — нотатка, і її id приходить клієнту', async () => {
    const me = await signIn(app, mailer, 'me5@example.com');
    const s = (await app.inject({ method: 'POST', url: '/v1/session', headers: { cookie: me.cookie }, payload: {} })).json() as { session: { id: string } };
    createMock.mockResolvedValueOnce(resp(JSON.stringify({
      reply: 'Зрозумів.',
      note: 'Гостре — не дуже',
    })));
    const r = await chat(me.cookie, s.session.id, 'я гостре не дуже, якщо чесно');
    const body = r.json() as { note_added: string | null; profile_focus: string | null };
    expect(body.note_added).toBeTruthy();
    // Головне: панель від нотатки НЕ виїжджає — вказівника немає.
    expect(body.profile_focus).toBeNull();
    const notes = await repo.listProfileNotes(me.user_id);
    expect(notes.map((n) => n.text)).toContain('Гостре — не дуже');
  });
});
