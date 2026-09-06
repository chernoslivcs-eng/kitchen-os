// @vitest-environment jsdom
//
// Крок Е1: що робить звичайний запит, коли сервер каже 401 / 429 / нічого.
//
// Головна перевірка тут — написане в полі вводу переживає 401. Це обіцянка
// стану «Треба зайти знову»: людина щойно набрала абзац, сесія протухла, і
// продукт не має права забрати в неї текст.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { api, registerIncidentSink } from './api';
import { useIncidentStore } from './store/incident';
import { IncidentStrips, useIncidentSink } from './components/ErrorState/IncidentStrips';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

beforeEach(() => {
  useIncidentStore.setState({ authExpired: false, throttledUntil: null, throttledFor: 0, offline: false });
  registerIncidentSink(null);
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  registerIncidentSink(null);
  vi.unstubAllGlobals();
});

/** Крихітний «екран»: поле вводу з набраним текстом плюс смуги з каркаса. */
function Screen() {
  useIncidentSink();
  return (
    <>
      <IncidentStrips />
      <textarea defaultValue="я почав писати довгу думку" data-input />
    </>
  );
}

async function mountScreen() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter><Screen /></MemoryRouter>); });
}

describe('401 у живому запиті', () => {
  it('показує смугу і НЕ чистить поле вводу', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, { error: 'unauthorized' })));
    await mountScreen();
    const input = () => host!.querySelector<HTMLTextAreaElement>('[data-input]')!;
    expect(input().value).toBe('я почав писати довгу думку');

    await act(async () => { await api.shopping.list().catch(() => {}); });

    expect(host!.querySelector('[data-strip]')).toBeTruthy();
    expect(host!.textContent).toContain('Вхід — уже ні.');
    // Головне: текст на місці. Саме це обіцяє копі «Переписувати нічого не треба».
    expect(input().value).toBe('я почав писати довгу думку');
  });

  it('401 на /v1/me при старті смуги НЕ показує — це «гість», а не «протухло»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, { error: 'unauthorized' })));
    await mountScreen();
    await act(async () => { await api.me().catch(() => {}); });
    expect(useIncidentStore.getState().authExpired).toBe(false);
    expect(host!.querySelector('[data-strip]')).toBeNull();
  });
});

describe('429', () => {
  it('час береться з Retry-After, а не з константи', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(429, { error: 'too many requests' }, { 'Retry-After': '17' })));
    await mountScreen();
    await act(async () => { await api.shopping.list().catch(() => {}); });
    expect(useIncidentStore.getState().throttledFor).toBe(17);
    expect(host!.querySelector('[data-strip-passes]')?.textContent).toBe('мине саме');
    // Кнопки немає: робити людині нічого не треба.
    expect(host!.querySelector('[data-strip] button')).toBeNull();
  });

  it('без заголовка — розумний запас, а не нуль', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(429, { error: 'too many requests' })));
    await mountScreen();
    await act(async () => { await api.shopping.list().catch(() => {}); });
    expect(useIncidentStore.getState().throttledFor).toBe(60);
  });
});

describe('мережа', () => {
  it('провал запиту піднімає смугу, успіх — знімає', async () => {
    const fail = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fail);
    await mountScreen();
    await act(async () => { await api.shopping.list().catch(() => {}); });
    expect(useIncidentStore.getState().offline).toBe(true);
    expect(host!.textContent).toContain('Чекаю на мережу.');

    vi.stubGlobal('fetch', vi.fn(async () => res(200, { count: 0, items: [] })));
    await act(async () => { await api.shopping.list().catch(() => {}); });
    expect(useIncidentStore.getState().offline).toBe(false);
  });

  it('«Стоп» із пул-9 не читається як офлайн', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const e = new Error('aborted'); e.name = 'AbortError'; throw e;
    }));
    await mountScreen();
    await act(async () => { await api.shopping.list().catch(() => {}); });
    expect(useIncidentStore.getState().offline).toBe(false);
  });
});
