// @vitest-environment jsdom
//
// Крок П3 (1, 3): вузьке правило панелі й застигла історична картка.
//
// Правило має лишитись вузьким: панель виїжджає САМА лише тоді, коли від
// людини щось потрібно. «Помітив мимохідь» панель не чіпає — інакше вона
// перетворюється на спливне вікно, яке б'є по руках посеред розмови.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Feed } from './Feed';
import { ProfileCard } from './cards';
import { usePanelStore } from '../../store/panel';
import type { ChatCard } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let chatReply: Record<string, unknown>;

const json = (o: unknown) =>
  new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

const profileBody = () => ({
  fields: {
    name: { text: 'Пилип', status: 'filled', updated_at: null },
    no: { text: '', status: 'empty', updated_at: null },
    ban: { text: 'фундук', status: 'filled', updated_at: null },
    love: { text: '', status: 'empty', updated_at: null },
    meh: { text: '', status: 'empty', updated_at: null },
    kit: { text: '', status: 'empty', updated_at: null },
    when: { text: '', status: 'empty', updated_at: null },
  },
  notes: [],
  defaults: { kit: [] },
  veto: [{ field: 'ban', kind: 'category', ref: 'фундук', label: 'фундук', allergy: true }],
});

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/v1/chat') return json(chatReply);
    if (url === '/v1/profile') return json(profileBody());
    if (url === '/v1/session/today') return json({ session: { id: 's1', created_at: '2026-09-07T06:00:00Z' }, messages: [] });
    if (url === '/v1/pantry') return json({ count: 0, batches: [], products: [] });
    if (url === '/v1/shopping') return json({ count: 0, items: [] });
    if (url === '/v1/cards/pending') return json({ cards: [] });
    if (url === '/v1/retail') return json({ silpo: { status: 'none' } });
    return json({});
  }));
}

async function mountFeed() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter><Feed /></MemoryRouter>); });
  await act(async () => { await Promise.resolve(); });
}

async function say(text: string) {
  const ta = host!.querySelector('textarea')!;
  await act(async () => {
    // React слухає свій onChange — значення треба ставити рідним сеттером,
    // інакше подія долітає, а стан лишається порожнім (той самий трюк, що в
    // Feed.test.tsx).
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const btn = host!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  await act(async () => { btn.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
}

beforeEach(() => {
  installFetch();
  usePanelStore.setState({ active: null, hidden: true, open: false, lastManualPick: 0 });
  chatReply = { reply: 'ок', card: null, card_id: null };
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove(); root = undefined; host = undefined;
  vi.unstubAllGlobals();
});

describe('П3 (3): коли панель виїжджає сама', () => {
  it('людина свідомо сказала про себе → панель відкривається на профілі', async () => {
    chatReply = { reply: 'Це має бути в профілі.', card: null, card_id: null, profile_focus: 'ban' };
    await mountFeed();
    await say('мені не можна лактозу');
    expect(usePanelStore.getState().active).toBe('profile');
    expect(usePanelStore.getState().hidden).toBe(false);
  });

  it('продукт помітив мимохідь → панель НЕ виїжджає', async () => {
    chatReply = { reply: 'Зрозумів.', card: null, card_id: null, note_added: 'n-1' };
    await mountFeed();
    await say('я гостре не дуже, якщо чесно');
    expect(usePanelStore.getState().active).not.toBe('profile');
    expect(usePanelStore.getState().hidden).toBe(true);
  });

  it('людина щойно обрала артефакт руками — вказівник її не перебиває', async () => {
    // Те саме правило, що рятувало список покупок від рецепта (пул-9 №6).
    chatReply = { reply: 'Це має бути в профілі.', card: null, card_id: null, profile_focus: 'ban' };
    await mountFeed();
    usePanelStore.getState().setActive('list');
    await say('мені не можна лактозу');
    expect(usePanelStore.getState().active).toBe('list');
  });

  it('профіль стоїть у панелі вкладкою — його можна відкрити й без вказівника', async () => {
    await mountFeed();
    expect(usePanelStore.getState().artifacts.some((a) => a.key === 'profile')).toBe(true);
  });
});

describe('П3 (1): історична картка поля профілю', () => {
  const render = async (card: ChatCard, over: Record<string, unknown> = {}) => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(<ProfileCard card={card} {...over} />); });
  };

  it('малюється застиглим рядком: поле, текст і мітка — без кнопок', async () => {
    await render({ type: 'profile', field: 'ban', mode: 'append', text: 'фундук' } as ChatCard, { applied: true });
    expect(host!.querySelector('[data-retired-profile-field="ban"]')).toBeTruthy();
    expect(host!.textContent).toContain('Мені не можна');
    expect(host!.textContent).toContain('фундук');
    expect(host!.querySelector('[data-meta]')!.textContent).toBe('ЗАПИСАНО');
    // Кнопок немає: писати в профіль із чату продукт більше не вміє.
    expect(host!.querySelectorAll('button')).toHaveLength(0);
  });

  it('незастосована стара картка каже це прямо, а не мовчить', async () => {
    await render({ type: 'profile', field: 'no', mode: 'append', text: 'кінзи' } as ChatCard);
    expect(host!.querySelector('[data-meta]')!.textContent).toBe('НЕ ЗАПИСАНО');
  });

  it('порожній текст не валить рендер', async () => {
    await render({ type: 'profile', field: 'ban', mode: 'replace', text: '' } as ChatCard, { dismissed: true });
    expect(host!.querySelector('[data-retired-profile-field="ban"]')).toBeTruthy();
    expect(host!.querySelector('[data-meta]')!.textContent).toBe('ПРОПУЩЕНО');
  });

  it('форма домашніх малюється як була — з кнопками', async () => {
    await render(
      { type: 'profile', ops: [{ op: 'add', kind: 'member', label: 'Оля' }] } as unknown as ChatCard,
      { onApply: () => {} },
    );
    expect(host!.textContent).toContain('Оля');
    expect(host!.querySelectorAll('button').length).toBeGreaterThan(0);
  });
});
