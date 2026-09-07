// @vitest-environment jsdom
//
// Крок О2 (1.1): картка «Про тебе» у стрічці — БЕЗ великої підложки.
//
// Онбординг малює власну панель: тло, рамка, радіус 18. Документ-підложка під
// нею читалась як рамка в рамці. Виняток той самий, що вже був у `event`, — але
// подія не малює нічого, а ця картка малює себе сама, тож перевіряти треба
// обидві частини: підложки немає, а картка є.
//
// CSS-модулі у vitest резолвляться в порожній обʼєкт, тому дивимось на
// структуру й імена класів у розмітці, а не на пікселі.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Feed } from './Feed';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const json = (o: unknown) =>
  new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

const field = () => ({ text: '', status: 'empty' as const, updated_at: null });

/** Ход із карткою заданого роду — рівно те, що стрічка отримує від сервера. */
function withCard(type: string, extra: Record<string, unknown> = {}) {
  return {
    session: { id: 's1', created_at: '2026-09-06T06:00:00Z' },
    messages: [
      { id: 'm0', session_id: 's1', role: 'user', text: 'привіт', card: null, applied: 0, created_at: '2026-09-06T06:00:00Z' },
      { id: 'm1', session_id: 's1', role: 'assistant', text: 'ось', card: { type, ...extra }, applied: 0, created_at: '2026-09-06T06:00:01Z' },
    ],
  };
}

function installFetch(today: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/v1/session/today') return json(today);
    if (url === '/v1/profile') return json({ fields: { name: field(), no: field(), ban: field(), love: field(), meh: field(), kit: field(), when: field() }, notes: [], veto_index: [] });
    if (url === '/v1/pantry') return json({ count: 0, batches: [], products: [] });
    if (url === '/v1/shopping') return json({ count: 0, items: [] });
    if (url === '/v1/cards/pending') return json({ cards: [] });
    if (url === '/v1/retail') return json({ silpo: { status: 'none' } });
    return json({});
  }));
}

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter><Feed /></MemoryRouter>); });
  // Стрічка тягне profile_text другим запитом — даємо йому доїхати.
  await act(async () => { await Promise.resolve(); });
}

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove(); root = undefined; host = undefined;
  vi.unstubAllGlobals();
});

describe('О2 (1.1): підложка під карткою у стрічці', () => {
  beforeEach(() => { localStorage.clear(); });

  it('онбординг — без підложки, але сама картка на місці', async () => {
    installFetch(withCard('onboarding'));
    await mount();
    const card = host!.querySelector('[data-onboarding-card]');
    expect(card).not.toBeNull();
    // Жодного doccard-предка над карткою.
    let el: Element | null = card;
    while (el && el !== host) {
      expect(el.className.toString()).not.toContain('doccard');
      el = el.parentElement;
    }
  });

  it('решта структурованих карток підложку зберігає', async () => {
    // Контроль: якби виняток був написаний надто широко, ця перевірка впала б.
    installFetch(withCard('shopping', { items: [{ label: 'молоко' }] }));
    await mount();
    expect(host!.querySelector('[class*="doccard"]')).not.toBeNull();
  });
});
