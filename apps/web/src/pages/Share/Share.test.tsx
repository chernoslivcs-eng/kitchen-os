// @vitest-environment jsdom
//
// Шерінг v3: /share/:recipe_id — дані з GET /v1/recipes/:id + GET
// /v1/cook-runs + GET /v1/telegram. Головний ризик, успадкований з PR #181
// (баг з проду, iPhone Chrome): await ПЕРЕД navigator.share()/a.click()
// зʼїдав user activation — тести на «жодного await у синхронному шляху
// кліку» лишаються тут головними, разом з новими для v3 (кадри, копіювання
// лінка, «без рецепта → /app»).
//
// Більшість тестів навмисно без фото (run=null): drawClean не чіпає
// getImageData/createLinearGradient/Image — найнадійніший шлях у jsdom, де
// завантаження зображень не працює. Наявність кадрів «Постер»/«Вертикаль»
// при фото — на рівні чистої логіки вже покрито в frame.test.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SharePage } from './Share';
import * as sentry from '../../lib/sentry';
import type { Recipe } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECIPE: Recipe = {
  t: 'Паста з томатами', sv: 2, tm: 25, ch: 'проста', d: 'Швидка вечеря на двох.', rk: 'не переварити',
  ing: [{ n: 'паста', v: 200, u: 'г' }, { n: 'томати', v: 400, u: 'г' }],
  st: [{ t: 'Готово', c: 'Подати.' }],
};

/** Будь-який виклик 2D-контексту — no-op; measureText/градієнти — форма, яку код читає. */
function fakeCtx(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'createLinearGradient') return () => ({ addColorStop: () => {} });
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4).fill(128) });
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
let fetchImpl: (url: string) => Promise<Response>;

function jsonRes(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
}

function defaultFetch(url: string): Promise<Response> {
  if (url.startsWith('/v1/recipes/')) return Promise.resolve(jsonRes({ id: 'recipe-1', saved_at: '2026-09-01T00:00:00.000Z', recipe: RECIPE }));
  if (url.startsWith('/v1/cook-runs')) return Promise.resolve(jsonRes({ runs: [] }));
  if (url.startsWith('/v1/telegram')) return Promise.resolve(jsonRes({ linked: false, username: null, linked_at: null }));
  return Promise.resolve(jsonRes({}));
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeCtx());
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
    // Той самий асинхронний характер, що справжній toBlob (черга мікрозадач).
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
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });

  vi.spyOn(sentry, 'captureClientIncident').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  fetchImpl = defaultFetch;
  vi.stubGlobal('fetch', vi.fn((url: string) => fetchImpl(url)));
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove(); root = undefined; host = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(path = '/share/recipe-1') {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/share/:recipe_id" element={<SharePage />} />
          <Route path="/no-id" element={<SharePage />} />
          <Route path="/app" element={<i data-landed="app" />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  // Завантаження (Promise.all трьох fetch) + ефект малювання (await fonts.ready → toBlob мікрозадача).
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
}

const shareBtn = () => host!.querySelector<HTMLButtonElement>('[data-share]')!;
const downloadBtn = () => host!.querySelector<HTMLButtonElement>('[data-download]')!;

describe('SharePage · без фото (лише «Чисте тло») · без await перед жестом (баг PR #181)', () => {
  it('кнопка «Поділитись» готова (не disabled) після підготовки PNG', async () => {
    await mount();
    expect(shareBtn().disabled).toBe(false);
    expect(shareBtn().textContent).toContain('Поділитись');
  });

  it('navigator.share викликається в ТОМУ Ж тіку, що клік — жодного await перед ним', async () => {
    await mount();
    let microtaskRan = false;
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

describe('SharePage · дані й кадри', () => {
  it('без фото — лише «Чисте тло», без крапок каруселі', async () => {
    await mount();
    expect(host!.querySelector('[data-frame="clean"]')).not.toBeNull();
    expect(host!.querySelector('[data-frame="poster"]')).toBeNull();
    expect(host!.querySelector('[data-frame="vertical"]')).toBeNull();
    expect(host!.querySelectorAll('[data-dot]').length).toBe(0);
  });

  it('назва рецепта — у шапці (1440), «Поділитись · <назва>»', async () => {
    await mount();
    expect(host!.textContent).toContain('Паста з томатами');
  });

  it('рядок лінка — host/r/<id>, тап копіює й показує «Скопійовано ✓» 2 с', async () => {
    await mount();
    const link = host!.querySelector<HTMLButtonElement>('[data-copy-link]')!;
    expect(link.textContent).toContain('/r/recipe-1');
    await act(async () => { link.click(); await Promise.resolve(); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('/r/recipe-1'));
    expect(host!.textContent).toContain('Скопійовано');
  });

  it('без recipe_id у параметрах — власний захист сторінки теж веде на /app (App.tsx для голого /share має свій Navigate; тут — той самий запобіжник усередині SharePage)', async () => {
    await mount('/no-id');
    expect(host!.querySelector('[data-landed="app"]')).not.toBeNull();
  });

  it('рецепт не знайдено (404) — видимий стан помилки, не порожній екран', async () => {
    fetchImpl = (url) => {
      if (url.startsWith('/v1/recipes/')) return Promise.resolve(jsonRes({ error: 'not_found' }, 404));
      return defaultFetch(url);
    };
    await mount();
    expect(host!.querySelector('[data-share-page]')!.textContent).toContain('Не вдалось відкрити');
  });

  it('телеграм не звʼязаний — «Зберегти PNG» і підказка про профіль, без «Надіслати в Telegram»', async () => {
    await mount();
    expect(host!.querySelector('[data-send-telegram]')).toBeNull();
    expect(host!.querySelector('[data-save-png]')).not.toBeNull();
    expect(host!.textContent).toContain('Звʼяжи Telegram у профілі');
  });

  it('телеграм звʼязаний — «Надіслати в Telegram» головною дією', async () => {
    fetchImpl = (url) => {
      if (url.startsWith('/v1/telegram')) return Promise.resolve(jsonRes({ linked: true, username: 'kitchen_os_bot', linked_at: '2026-09-01T00:00:00.000Z' }));
      return defaultFetch(url);
    };
    await mount();
    expect(host!.querySelector('[data-send-telegram]')).not.toBeNull();
  });
});
