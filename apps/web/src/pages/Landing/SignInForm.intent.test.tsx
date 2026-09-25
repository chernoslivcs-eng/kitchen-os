// @vitest-environment jsdom
// Постановка 2026-09-25 (біллінг LiqPay) §5: ?intent=<order_id> у URL (після
// повернення з checkout LiqPay, result_url=/?intent=...#l3-signin) кладе
// order_id у localStorage (kos_intent) і чистить адресу; рядок «Підписка
// оформлена — лишилось увійти» показується, поки intent є — з URL чи вже з
// localStorage (перезавантаження сторінки після checkout, до входу).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SignInForm } from './SignInForm';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter><SignInForm /></MemoryRouter>); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ google: false, telegram: false, telegramBotId: null })));
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear();
  window.history.pushState(null, '', '/');
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.unstubAllGlobals();
  window.history.pushState(null, '', '/');
});

describe('SignInForm · intent з чекауту (біллінг LiqPay)', () => {
  it('?intent= у URL → рядок показано, order_id у localStorage, URL прибрано', async () => {
    window.history.pushState(null, '', '/?intent=ord-live-1#l3-signin');
    await mount();

    expect(host!.textContent).toContain('Підписка оформлена — лишилось увійти');
    expect(localStorage.getItem('kos_intent')).toBe('ord-live-1');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#l3-signin');
  });

  it('intent уже в localStorage (без URL) — рядок теж показано', async () => {
    localStorage.setItem('kos_intent', 'ord-cached');
    await mount();
    expect(host!.textContent).toContain('Підписка оформлена — лишилось увійти');
  });

  it('без intent — рядка нема', async () => {
    await mount();
    expect(host!.textContent).not.toContain('Підписка оформлена');
  });

  it('URL зберігає інші параметри поруч із intent', async () => {
    window.history.pushState(null, '', '/?foo=bar&intent=ord-live-2');
    await mount();
    expect(window.location.search).toBe('?foo=bar');
    expect(localStorage.getItem('kos_intent')).toBe('ord-live-2');
  });
});
