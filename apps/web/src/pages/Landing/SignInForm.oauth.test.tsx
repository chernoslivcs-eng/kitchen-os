// @vitest-environment jsdom
// Хотфікс 27.09: колбек Google без state-куки більше не показує людині
// {"error":"state mismatch"} — сервер веде на /?err=oauth_state#l3-signin, а
// форма входу каже, що робити далі.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SIGNIN } from './copy';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined; let host: HTMLDivElement | undefined;

// Прапорець «вже прочитано» живе в модулі, тож кожен тест бере СВІЙ модуль:
// інакше другий тест проходив би лише тому, що перший спожив параметр, і не
// доводив би нічого.
async function mount() {
  vi.resetModules();
  const { SignInForm } = await import('./SignInForm');
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter><SignInForm id="l3-signin" /></MemoryRouter>); });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('SignInForm · ?err=oauth_state', () => {
  it('показує рядок «спробуй ще раз» і прибирає err з адреси', async () => {
    window.history.replaceState(null, '', '/?err=oauth_state#l3-signin');
    await mount();
    expect(host!.textContent).toContain(SIGNIN.oauthRetry);
    // Слово «state» людині не показуємо — воно ні про що їй не каже.
    expect(host!.textContent).not.toContain('state');
    // Адреса чиста: перезавантаження не покаже рядок удруге.
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#l3-signin');
  });

  it('без параметра рядка немає', async () => {
    window.history.replaceState(null, '', '/');
    await mount();
    expect(host!.textContent).not.toContain(SIGNIN.oauthRetry);
  });

  it('чужий err рядка не показує', async () => {
    window.history.replaceState(null, '', '/?err=no_account&via=google');
    await mount();
    expect(host!.textContent).not.toContain(SIGNIN.oauthRetry);
  });
});
