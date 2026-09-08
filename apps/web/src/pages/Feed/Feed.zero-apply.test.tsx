// @vitest-environment jsdom
//
// П4-Т2, клієнтська частина. Рішення про те, чи картка закривається, ухвалює
// стрічка — і ухвалювала його безумовно: `applied: true` ставилось відразу
// після виклику, не дивлячись на те, що відповів сервер. Тому серверна
// правка сама по собі дала б розходження: сервер каже «не застосовано,
// токена немає», а картка закривається й пропонує скасувати ніщо.
//
// Три речі мусять сказати правду при нулі: тост, дія тоста і сама картка.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Feed } from './Feed';
import { usePanelStore } from '../../store/panel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let waiting: { resolve: (body: unknown) => void }[];
let applyBody: unknown;

const json = (o: unknown) =>
  new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

// Картка, яку гілка профілю не вміє застосувати: вона обробляє лише
// kind: 'member'. Саме ця форма дала три штампи на нулі в проді.
const unknownOpCard = {
  type: 'profile',
  ops: [{ kind: 'preference', op: 'add', label: 'люблю гостре' }],
};

function installFetch(applyResult: unknown) {
  waiting = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/v1/chat') return new Promise((resolve) => { waiting.push({ resolve: (b) => resolve(json(b)) }); });
    if (url === '/v1/cards/c1/apply') {
      applyBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      return json(applyResult);
    }
    if (url === '/v1/pantry') return json({ count: 0, batches: [], products: [] });
    if (url === '/v1/shopping') return json({ count: 0, items: [] });
    if (url === '/v1/cards/pending') return json({ cards: [] });
    if (url === '/v1/retail') return json({ silpo: { status: 'none' } });
    if (url === '/v1/session/today') return json({ session: { id: 's1', created_at: '2026-09-08T06:00:00Z' }, messages: [] });
    return json({});
  }));
}

const q = <T extends Element>(sel: string) => host!.querySelector<T>(sel);
const buttonByText = (text: string) =>
  [...host!.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

async function mountAndGetCard() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter><Feed /></MemoryRouter>); });

  const el = q<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, 'я люблю гостре');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { q<HTMLButtonElement>('button[type="submit"]')!.click(); });
  await act(async () => {
    waiting[0]!.resolve({ reply: 'Записати?', card: unknownOpCard, card_id: 'c1' });
  });
}

beforeEach(() => {
  applyBody = undefined;
  vi.useRealTimers();
  usePanelStore.setState({ artifacts: [], freshKeys: [], active: null, lastManualPick: 0, hidden: false, fresh: false });
  vi.stubGlobal('matchMedia', (m: string) => ({ matches: true, media: m, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = undefined;
  host = undefined;
  vi.unstubAllGlobals();
});

describe('нульове застосування: картка не закривається, «Скасувати» не пропонується', () => {
  it('applied: 0 — тост каже правду, дії скасування немає, кнопки картки лишаються', async () => {
    installFetch({ applied: 0, undo_token: null, already: false });
    await mountAndGetCard();

    await act(async () => { buttonByText('Записати')!.click(); });
    expect(applyBody).toBeTruthy();

    // Тост: не «Записано в „Про тебе"», а те, що сталось насправді.
    const toast = q<HTMLElement>('[data-toast]');
    expect(toast?.textContent).toContain('нічого не змінилось');
    expect(toast?.textContent).not.toContain('Записано');

    // Скасовувати нічого — кнопки бути не повинно.
    expect(q('[data-toast-action]')).toBeNull();

    // Картка лишається робочою: обидві кнопки на місці, «Ні» доступне.
    expect(buttonByText('Записати')).toBeTruthy();
    expect(buttonByText('Ні')).toBeTruthy();
  });

  it('applied: 1 — картка закривається і «Скасувати» на місці (робочий шлях не зачеплено)', async () => {
    installFetch({ applied: 1, undo_token: 'tok-1', already: false });
    await mountAndGetCard();

    await act(async () => { buttonByText('Записати')!.click(); });

    expect(q<HTMLElement>('[data-toast]')?.textContent).toContain('Записано в „Про тебе"');
    expect(q<HTMLElement>('[data-toast-action]')?.textContent).toContain('Скасувати');
    expect(buttonByText('Записати')).toBeUndefined();
  });
});
