// @vitest-environment jsdom
// Канарка 28.09: власник оплатив, повернувся на /?intent=<order_id> УЖЕ
// залогіненим — і привʼязки не сталось. `?intent=` читає SignInForm, а він
// живе в Landing, який для залогіненого не монтується: RedirectIfSignedIn
// відправляє на /app раніше. Намір висів, поки людина не вийшла й не зайшла
// за тим самим посиланням.
//
// Тест ставить рівно ту саму збірку, що App: RedirectIfSignedIn на «/», Shell
// на «/app», — і дивиться, чи дійде bind.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RedirectIfSignedIn } from './App';
import { Shell } from './Shell';
import { useAuth } from './store/auth';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined; let host: HTMLDivElement | undefined;
const ME = {
  user: { id: 'u1', name: 'Т', email: 't@x.test', welcome_seen_at: '2026-01-01T00:00:00Z' },
  household: { id: 'h1', name: 'Дім', role: 'owner', members: [] },
} as never;

const bindCalls: string[] = [];
function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/v1/billing/bind') {
      bindCalls.push(String((JSON.parse(String(init?.body ?? '{}')) as { order_id?: string }).order_id));
      return new Response(JSON.stringify({ subscription: { state: 'trial' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }));
}

async function mountAt(entry: string) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/" element={<RedirectIfSignedIn><div>лендінг</div></RedirectIfSignedIn>} />
          <Route element={<Shell />}><Route path="/app" element={<div data-app />} /></Route>
        </Routes>
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  bindCalls.length = 0;
  localStorage.clear();
  installFetch();
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  useAuth.setState({ me: ME, status: 'signed_in' } as never);
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.unstubAllGlobals();
});

describe('залогінений відкриває /?intent=<id>', () => {
  it('намір забирається з адреси й привʼязується — без виходу з акаунта', async () => {
    await mountAt('/?intent=ord-canary');
    await act(async () => { await Promise.resolve(); });
    expect(bindCalls).toContain('ord-canary');
    // Ключ уже прибрано: успішний bind його споживає. Якби він лишався,
    // привʼязка повторювалась би на кожному завантаженні застосунку.
    expect(localStorage.getItem('kos_intent')).toBeNull();
    // Лендінг при цьому не показуємо — людина вже в застосунку.
    expect(host!.textContent).not.toContain('лендінг');
  });

  it('без параметра нічого не привʼязуємо', async () => {
    await mountAt('/');
    await act(async () => { await Promise.resolve(); });
    expect(localStorage.getItem('kos_intent')).toBeNull();
    expect(bindCalls).toHaveLength(0);
  });
});
