// @vitest-environment jsdom
//
// Крок О1: димовий тест символікації, фронтова половина.
//
// Головне тут — не сам вибух, а те, що людина після нього бачить ЕКРАН, а не
// білу сторінку, і що подія при цьому все одно летить. Обидві половини цієї
// пари ламаються тихо: межу React ніхто не чіпає місяцями, і дізнатись, що
// вона перестала ловити, можна лише падінням.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BoomPage } from './Boom';
import { ErrorBoundary } from '../../components/ErrorState/ErrorBoundary';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let calls: string[];
let quiet: ReturnType<typeof vi.spyOn>;

/** allowed=false вдає той самий 404, що сервер дає чужому. */
function installFetch(allowed: boolean) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    return allowed
      ? new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('{"error":"not_found"}', { status: 404, headers: { 'content-type': 'application/json' } });
  }));
}

async function mount(ui: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(ui); });
}

beforeEach(() => {
  // React друкує впіймане падіння в консоль — у прогоні це шум, не сигнал.
  quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = undefined; host = undefined;
  quiet.mockRestore();
  vi.unstubAllGlobals();
});

describe('/admin/boom', () => {
  it('чужому — 404, і жодного падіння', async () => {
    installFetch(false);
    const seen: Error[] = [];
    await mount(<ErrorBoundary onError={(e) => { seen.push(e); }}><BoomPage /></ErrorBoundary>);
    expect(host!.textContent).toBe('404');
    // Сторінка не видає, що вона існує, — і нічого не ламає по дорозі.
    expect(seen).toHaveLength(0);
    expect(document.querySelector('[data-error-screen]')).toBeNull();
  });

  it('питає дозволу тим самим маршрутом, що вибухає, тільки з ?dry=1', async () => {
    installFetch(false);
    await mount(<ErrorBoundary onError={() => {}}><BoomPage /></ErrorBoundary>);
    expect(calls).toEqual(['/v1/admin/boom?dry=1']);
  });

  it('власнику падає в РЕНДЕРІ, і людина бачить екран, а не білу сторінку', async () => {
    installFetch(true);
    await mount(<ErrorBoundary onError={() => 'a1b2c3d4'}><BoomPage /></ErrorBoundary>);
    // Саме екран Е1, з обома рядками заголовка.
    expect(document.querySelector('[data-error-screen]')).toBeTruthy();
    expect(host!.textContent).toContain('Комора на місці.');
    expect(host!.textContent).toContain('Цей екран — ні.');
  });

  it('межа НЕ ковтає подію — вона йде назовні', async () => {
    installFetch(true);
    const seen: Error[] = [];
    await mount(<ErrorBoundary onError={(e) => { seen.push(e); return 'a1b2c3d4'; }}><BoomPage /></ErrorBoundary>);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.message).toContain('димовий тест символікації');
    // Стек із трьома нашими кадрами — те, заради чого сорсмепи існують.
    const stack = seen[0]!.stack ?? '';
    expect(stack).toContain('measureShelf');
    expect(stack).toContain('describeShelf');
    expect(stack).toContain('renderNightPlan');
  });

  it('код інциденту видно на екрані — за ним власник знайде подію', async () => {
    installFetch(true);
    await mount(<ErrorBoundary onError={() => 'a1b2c3d4'}><BoomPage /></ErrorBoundary>);
    expect(document.querySelector('[data-error-code]')?.textContent).toBe('a1b2c3d4');
  });
});
