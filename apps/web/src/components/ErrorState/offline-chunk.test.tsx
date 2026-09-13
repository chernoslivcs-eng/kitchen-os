// @vitest-environment jsdom
// Аудит 0913 C.3: помилка з міткою ChunkOfflineError (lib/lazyPage) — екран
// «нема мережі» з «Повторити», без коду інциденту; «Повторити» = reload.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary';
import { OFFLINE_CHUNK, CRASH } from './copy';
import { ChunkOfflineError } from '../../lib/lazyPage';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Boom({ offline }: { offline: boolean }): never {
  throw offline ? new ChunkOfflineError(new TypeError('Importing a module script failed')) : new Error('crash');
}

describe('ErrorBoundary · офлайн-чанк', () => {
  let root: Root | undefined; let host: HTMLDivElement | undefined;
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); });
  const mount = async (offline: boolean, onReload: () => void) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<ErrorBoundary onError={() => 'E7F2'} onReload={onReload}><Boom offline={offline} /></ErrorBoundary>); });
  };

  it('офлайн → екран «нема мережі», без коду, «Повторити» перезавантажує', async () => {
    const reload = vi.fn();
    await mount(true, reload);
    expect(host!.textContent).toContain(OFFLINE_CHUNK.h1b);
    expect(host!.textContent).not.toContain(CRASH.h1b);
    expect(host!.textContent).not.toContain('E7F2');
    const cta = [...host!.querySelectorAll('button')].find((b) => b.textContent?.includes(OFFLINE_CHUNK.cta))!;
    await act(async () => { cta.click(); });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('звичайне падіння — екран падіння з кодом, як і було', async () => {
    await mount(false, () => {});
    expect(host!.textContent).toContain(CRASH.h1b);
    expect(host!.textContent).toContain('E7F2');
  });
});
