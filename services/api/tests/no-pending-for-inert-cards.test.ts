// П4-Т6. createPending кликався на будь-яку картку. Для родин із applyMode
// 'none' (пропозиція, слід рецепта, кошик, службові маркери, онбординг)
// apply-гілки не існує взагалі — тож рядок ніколи не ставав ані
// застосованим, ані відхиленим. Він просто висів. У проді таких 47, усі
// від proposal.
//
// Це облік того, чого не буває: черга рішень, у якій лежить те, про що
// рішення не ухвалюють.
//
// Стаб моделі пропозицій не віддає, тому картку сюди приносить мок SDK —
// інакше довелось би перевіряти критерій на сусідній родині.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: createMock }; },
}));

const { buildApp } = await import('../src/server.js');
const { InMemoryRepo, applyMode, CARD_APPLY_MODE } = await import('@kitchen/domain');
const { InMemoryStore } = await import('../src/attachment-store.js');
const { ConsoleMailer } = await import('../src/mailer.js');
const { signIn } = await import('./helpers.js');
type Card = import('@kitchen/domain').Card;

function resp(text: string) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    stop_reason: 'end_turn',
  };
}

const PROPOSAL = JSON.stringify({
  reply: 'Ось два варіанти на вечерю.',
  card: { type: 'proposal', items: [{ title: 'Паста качо е пепе', desc: 'Гостро й швидко' }] },
});

let repo: InstanceType<typeof InMemoryRepo>;
let app: Awaited<ReturnType<typeof buildApp>>;
let me: Awaited<ReturnType<typeof signIn>>;
const OLD_ENV = { ...process.env };

beforeEach(async () => {
  createMock.mockReset();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  delete process.env.OPENROUTER_API_KEY;
  repo = new InMemoryRepo();
  const mailer = new ConsoleMailer();
  app = buildApp(repo, new InMemoryStore(), mailer);
  await app.ready();
  me = await signIn(app, mailer, 'me@example.com');
});

afterEach(() => { process.env = { ...OLD_ENV }; });

const chat = async (text: string) => (await app.inject({
  method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie }, payload: { text },
})).json();

describe('pending не заводиться там, де застосування не буває', () => {
  it('після proposal-картки рядка в card_pending немає', async () => {
    createMock.mockResolvedValue(resp(PROPOSAL));
    const body = await chat('що приготувати на вечерю?');

    expect(body.card?.type).toBe('proposal');
    expect(applyMode('proposal')).toBe('none');
    expect(await repo.getPending(body.card_id)).toBeNull();

    // Головне, що НЕ зникло: id картки. Ним живе стрічка — «Відкрити» й
    // «Уточнити» ходять від card_id, а не від pending.
    expect(body.card_id).toBeTruthy();
    const msg = await repo.getMessage(body.card_id);
    expect((msg?.card as Card | null)?.type).toBe('proposal');
    expect((msg?.card as { items?: unknown[] } | null)?.items).toHaveLength(1);
  });

  it('пропозиція не потрапляє в чергу ОЧІКУЮТЬ', async () => {
    createMock.mockResolvedValue(resp(PROPOSAL));
    await chat('що приготувати на вечерю?');
    const pend = (await app.inject({
      method: 'GET', url: '/v1/cards/pending', headers: { cookie: me.cookie },
    })).json();
    expect(pend.cards.map((c: { type: string }) => c.type)).not.toContain('proposal');
  });

  it('дійова картка pending отримує — гейт не зачепив робочі родини', async () => {
    createMock.mockResolvedValue(resp(JSON.stringify({
      reply: 'Записав.',
      card: { type: 'shopping', items: [{ op: 'add', label: 'сіль' }] },
    })));
    const body = await chat('додай сіль у список');
    expect(applyMode('shopping')).not.toBe('none');
    expect(await repo.getPending(body.card_id)).not.toBeNull();
  });

  it('перелік інертних родин не поповзе мовчки', () => {
    // Гейт читає applyMode, а не список типів. Якщо родина переїде в 'none'
    // (або звідти), це рішення — і воно має бути видно тут, а не зʼясуватись
    // на проді через порожню чергу.
    const inert = Object.entries(CARD_APPLY_MODE)
      .filter(([, mode]) => mode === 'none').map(([t]) => t).sort();
    expect(inert).toEqual([
      'cart', 'cart_go', 'cook_go', 'onboarding',
      'proposal', 'recipe_edit', 'recipe_link', 'retail_search_go',
    ]);
  });
});
