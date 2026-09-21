// @vitest-environment jsdom
//
// Баг з проду (iPhone, Chrome): «Поділитись»/завантаження нічого не робили —
// `await toPngBlob()` ПЕРЕД navigator.share()/a.click() зʼїдав user
// activation, iOS кидав NotAllowedError (ковтався порожнім catch), iOS-
// Chrome ігнорував a.click() після await. Головний тест тут — саме про
// ВІДСУТНІСТЬ await у синхронному шляху кліку, не про сам PNG.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SharePage } from './Share';
import * as sentry from '../../lib/sentry';
import type { Recipe } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECIPE: Recipe = {
  t: 'Паста з томатами', sv: 2, tm: 25, ch: 'проста', d: 'Швидка вечеря', rk: 'не переварити',
  ing: [{ n: 'паста', v: 200, u: 'г' }],
  st: [{ t: 'Готово', c: 'Подати.' }],
};

/** Будь-який виклик 2D-контексту — no-op; measureText має повертати {width}. */
function fakeCtx(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop in t) return t[prop as string];
      return () => {};
    },
    set(t, prop, value) { t[prop as string] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let shareMock: ReturnType<typeof vi.fn>;
let canShareMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeCtx());
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
    // Той самий async-характер, що справжній toBlob (черга мікрозадач),
    // без синхронного виклику — інакше тест не ловив би різницю з await.
    queueMicrotask(() => cb(new Blob(['png'], { type: 'image/png' })));
  });
  if (!('fonts' in document)) {
    Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve() }, configurable: true });
  }
  if (!('createObjectURL' in URL)) Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:x', configurable: true });
  if (!('revokeObjectURL' in URL)) Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true });
  else vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x');

  shareMock = vi.fn().mockResolvedValue(undefined);
  canShareMock = vi.fn().mockReturnValue(true);
  Object.defineProperty(navigator, 'share', { value: shareMock, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: canShareMock, configurable: true });
  Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148', configurable: true });

  vi.spyOn(sentry, 'captureClientIncident').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove(); root = undefined; host = undefined;
  vi.restoreAllMocks();
});

async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[{ pathname: '/share', state: { recipe: RECIPE } }]}>
        <SharePage />
      </MemoryRouter>,
    );
  });
  // Ефект готування PNG: await redraw() (await document.fonts.ready) → toBlob
  // (queueMicrotask) — кілька тіків, поки `ready` не стане true.
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

const shareBtn = () => host!.querySelector<HTMLButtonElement>('[data-share]')!;
const downloadBtn = () => host!.querySelector<HTMLButtonElement>('[data-download]')!;

describe('SharePage · «Поділитись»/завантаження без await перед жестом (баг з проду)', () => {
  it('кнопка «Поділитись» готова (не disabled) після підготовки PNG', async () => {
    await mount();
    expect(shareBtn().disabled).toBe(false);
    expect(shareBtn().textContent).toContain('Поділитись');
  });

  it('navigator.share викликається в ТОМУ Ж тіку, що клік — жодного await перед ним', async () => {
    await mount();
    let microtaskRan = false;
    // Мікрозадача, поставлена ДО кліку: якщо після click() вона ще не
    // відпрацювала, а share() вже викликаний — між кліком і share() не
    // було жодного await (саме це й було зламано в проді).
    void Promise.resolve().then(() => { microtaskRan = true; });
    act(() => { shareBtn().click(); });
    expect(shareMock).toHaveBeenCalledTimes(1);
    expect(microtaskRan).toBe(false);
    await act(async () => { await Promise.resolve(); });
  });

  it('AbortError (сам скасував) — тихо, без підпису-помилки й без інциденту', async () => {
    shareMock.mockRejectedValueOnce(Object.assign(new Error('cancel'), { name: 'AbortError' }));
    await mount();
    await act(async () => { shareBtn().click(); await Promise.resolve(); await Promise.resolve(); });
    expect(host!.querySelector('[data-share-error]')).toBeNull();
    expect(sentry.captureClientIncident).not.toHaveBeenCalled();
  });

  it('NotAllowedError (чи будь-яка інша відмова) — видимий підпис, інцидент, фокус на «Завантажити»', async () => {
    shareMock.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    await mount();
    await act(async () => { shareBtn().click(); await Promise.resolve(); await Promise.resolve(); });
    expect(host!.querySelector('[data-share-error]')!.textContent).toBe('Не вдалось відкрити меню — збережи PNG');
    expect(sentry.captureClientIncident).toHaveBeenCalledWith('share-failed', expect.objectContaining({ name: 'NotAllowedError' }));
    expect(document.activeElement).toBe(downloadBtn());
  });

  it('«Завантажити PNG» бере готовий blob синхронно — a.click() у тому самому тіку', async () => {
    await mount();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let microtaskRan = false;
    void Promise.resolve().then(() => { microtaskRan = true; });
    act(() => { downloadBtn().click(); });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(microtaskRan).toBe(false);
    clickSpy.mockRestore();
  });
});
