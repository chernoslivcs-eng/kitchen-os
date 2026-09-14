// @vitest-environment jsdom
// 14.09, власник: онбординг вимкнено. Новий акаунт після входу лишається в
// /app — редиректу на /welcome з каркаса нема; сам маршрут /welcome живий.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Shell } from './Shell';
import { useAuth } from './store/auth';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined; let host: HTMLDivElement | undefined;
function Where() { return <div data-where>{useLocation().pathname}</div>; }

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
  useAuth.setState({ me: { user: { id: 'u-new', name: 'Нова', email: 'n@x.local', plan: 'beta', welcome_seen_at: null }, household: { id: 'h1', name: 'Дім', role: 'owner', members: [] } } as never });
});
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); vi.unstubAllGlobals(); });

describe('онбординг вимкнено', () => {
  it('новий акаунт на /app лишається на /app, не /welcome', async () => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={['/app']}>
          <Routes><Route element={<Shell />}><Route path="/app" element={<Where />} /><Route path="/welcome" element={<Where />} /></Route></Routes>
        </MemoryRouter>,
      );
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(host!.querySelector('[data-where]')!.textContent).toBe('/app');
  });
});
