// @vitest-environment jsdom
// Постановка 2026-09-25 (біллінг LiqPay), Task 7: після входу з intent у
// localStorage (kos_intent) Shell привʼязує намір до дому.
//   200 {subscription} → ключ прибрано, тост «Підписка привʼязана», /profile
//   202 {status:'pending'} → повтор 3с до 30с; після 30с ключ лишається, тост «чекаємо банк»
//   410 → ключ прибрано, тост «застаріло»
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Shell } from './Shell';
import { useAuth } from './store/auth';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined; let host: HTMLDivElement | undefined;
function Where() { return <div data-where>{useLocation().pathname}</div>; }

const ME = { user: { id: 'u1', name: 'Т', email: 't@x.test', welcome_seen_at: '2026-01-01T00:00:00Z' }, household: { id: 'h1', name: 'Дім', role: 'owner', members: [] } } as never;

function installFetch(bindHandler: () => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/v1/billing/bind') return bindHandler();
    void init;
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }));
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={['/app']}>
        <Routes><Route element={<Shell />}><Route path="/app" element={<Where />} /><Route path="/profile" element={<Where />} /></Route></Routes>
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  useAuth.setState({ me: ME });
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Shell · привʼязка intent після входу', () => {
  it('без kos_intent у localStorage — bind не викликається', async () => {
    const bindCalls: unknown[] = [];
    installFetch(() => { bindCalls.push(1); return json({}); });
    await mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(bindCalls).toHaveLength(0);
  });

  it('200 {subscription} — ключ прибрано, тост, перехід на /profile', async () => {
    localStorage.setItem('kos_intent', 'ord-1');
    installFetch(() => json({ subscription: { state: 'trial', plan: 'self', trial_ends_at: null, next_charge_at: null, card_mask: '4242' } }));
    await mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(localStorage.getItem('kos_intent')).toBeNull();
    expect(host!.textContent).toContain('Підписка привʼязана');
    expect(host!.querySelector('[data-where]')!.textContent).toBe('/profile');
  });

  it('410 — ключ прибрано, тост «застаріло», без переходу', async () => {
    localStorage.setItem('kos_intent', 'ord-2');
    installFetch(() => json({ error: 'intent_expired' }, 410));
    await mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(localStorage.getItem('kos_intent')).toBeNull();
    expect(host!.textContent).toContain('Оформлення застаріло');
    expect(host!.querySelector('[data-where]')!.textContent).toBe('/app');
  });

  it('409 already_subscribed — ключ прибрано, тост «У дому вже є підписка»', async () => {
    localStorage.setItem('kos_intent', 'ord-3');
    installFetch(() => json({ error: 'already_subscribed' }, 409));
    await mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(localStorage.getItem('kos_intent')).toBeNull();
    expect(host!.textContent).toContain('У дому вже є підписка');
  });

  it('409 already_bound — ключ прибрано мовчки, без тоста', async () => {
    localStorage.setItem('kos_intent', 'ord-4');
    installFetch(() => json({ error: 'already_bound' }, 409));
    await mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(localStorage.getItem('kos_intent')).toBeNull();
    expect(host!.querySelector('[role="alert"], [class*="toast"]')).toBeNull();
  });

  it('202 pending 30с поспіль — ключ лишається, тост «чекаємо банк»', async () => {
    vi.useFakeTimers();
    localStorage.setItem('kos_intent', 'ord-5');
    installFetch(() => json({ status: 'pending' }, 202));
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

    expect(localStorage.getItem('kos_intent')).toBe('ord-5');
    expect(host!.textContent).toContain('Чекаємо підтвердження від банку');
  });
});
