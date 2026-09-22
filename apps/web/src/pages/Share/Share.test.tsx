// @vitest-environment jsdom
//
// Шерінг v3: /share/:recipe_id — дані з GET /v1/recipes/:id + GET
// /v1/cook-runs?recipe_id= + GET /v1/me (telegram_linked). Головний ризик,
// успадкований з PR #181
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
  if (url.startsWith('/v1/me')) return Promise.resolve(jsonRes({ user: { id: 'u1', name: 'Т', email: 't@example.com' }, household: { id: 'h1', name: 'Дім', role: 'owner', members: [] }, session_id: 's1', telegram_linked: false }));
  return Promise.resolve(jsonRes({}));
}

beforeEach(() => {
  sessionStorage.clear();
  // jsdom не має execCommand (legacyCopy — фолбек копіювання лінка).
  if (!('execCommand' in document)) {
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true, writable: true });
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeCtx());
  // Правка 9: PNG більше не через toBlob (асинхронний) — canvasToBlobSync
  // читає toDataURL СИНХРОННО (як і справжній canvas), тому мок теж синхронний.
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => 'data:image/png;base64,cG5n');
  if (!('fonts' in document)) {
    Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve() }, configurable: true });
  }
  // Правка 8: onPickPhoto (заглушка → фото) читає createImageBitmap — jsdom
  // не має декодування зображень узагалі, тож повністю глушимо.
  if (!('createImageBitmap' in window)) {
    Object.defineProperty(window, 'createImageBitmap', { value: vi.fn(), configurable: true, writable: true });
  }
  vi.spyOn(window, 'createImageBitmap').mockResolvedValue({ width: 10, height: 10 } as unknown as ImageBitmap);
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
// Правка 8: без фото Постер тепер активний за замовчуванням, як заглушка
// («Додати фото», не шериться) — тести на sync-жест share()/download()
// перевіряють саму МЕХАНІКУ кліку, тож перемикають на «Чисте тло» (єдиний
// кадр без фото, що лишається повністю «живим» для «Поділитись»/«Зберегти»).
// Правка 22.09 (п.14): крапки прибрано — пряме перемикання лишилось лише
// мініатюрами (`[data-thumb]`, десктопна колонка, у DOM завжди, CSS лише
// ховає на <768 — jsdom верстку не рахує, тож для тестів це годиться).
function selectClean() {
  act(() => { host!.querySelector<HTMLButtonElement>('[data-thumb="clean"]')!.click(); });
}

describe('SharePage · без await перед жестом (баг PR #181), на «Чистому тлі»', () => {
  it('кнопка «Поділитись» готова (не disabled) після підготовки PNG', async () => {
    await mount();
    selectClean();
    expect(shareBtn().disabled).toBe(false);
    expect(shareBtn().textContent).toContain('Поділитись');
  });

  it('navigator.share викликається в ТОМУ Ж тіку, що клік — жодного await перед ним', async () => {
    await mount();
    selectClean();
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
    selectClean();
    await act(async () => { shareBtn().click(); await Promise.resolve(); await Promise.resolve(); });
    expect(host!.querySelector('[data-share-error]')).toBeNull();
    expect(sentry.captureClientIncident).not.toHaveBeenCalled();
  });

  it('NotAllowedError (чи будь-яка інша відмова) — видимий підпис, інцидент, фокус на «Завантажити»', async () => {
    shareMock.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    await mount();
    selectClean();
    await act(async () => { shareBtn().click(); await Promise.resolve(); await Promise.resolve(); });
    expect(host!.querySelector('[data-share-error]')!.textContent).toBe('Не вдалось відкрити меню — збережи PNG');
    expect(sentry.captureClientIncident).toHaveBeenCalledWith('share-failed', expect.objectContaining({ name: 'NotAllowedError' }));
    expect(document.activeElement).toBe(downloadBtn());
  });

  it('«Завантажити PNG» бере готовий blob синхронно — a.click() у тому самому тіку', async () => {
    await mount();
    selectClean();
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
  // Правка 8 (22.09): без фото Постер (і Вертикаль, якщо назва влізає)
  // лишаються в каруселі як заглушка — не лише «Чисте тло». «Розкладка»
  // (Р203) — теж завжди в ролі, без умови fit, тому мінімум 3 кадри
  // (постер+розкладка+чисте), максимум 4 (+вертикаль).
  it('без фото — 3–4 кадри (заглушка постера + розкладка + чисте), мініатюри є', async () => {
    await mount();
    expect(host!.querySelector('[data-frame="clean"]')).not.toBeNull();
    const poster = host!.querySelector('[data-frame="poster"]')!;
    expect(poster).not.toBeNull();
    expect(poster.getAttribute('data-placeholder')).toBe('true');
    const thumbs = host!.querySelectorAll('[data-thumb]').length;
    expect(thumbs === 3 || thumbs === 4).toBe(true);
  });

  it('без фото, активний постер — головна кнопка «Додати фото», не шериться', async () => {
    await mount();
    const addPhotoBtn = host!.querySelector<HTMLButtonElement>('[data-add-photo]')!;
    expect(addPhotoBtn).not.toBeNull();
    expect(addPhotoBtn.textContent).toContain('Додати фото');
    expect(host!.querySelector('[data-share]')).toBeNull();
    expect(host!.querySelector('[data-download]')).toBeNull();
    // Рядок лінка лишається доступним навіть на заглушці.
    expect(host!.querySelector('[data-copy-link]')).not.toBeNull();
  });

  it('після вибору фото на заглушці — кнопка повертається до «Поділитись»', async () => {
    await mount();
    expect(host!.querySelector('[data-add-photo]')).not.toBeNull();
    const input = host!.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(host!.querySelector('[data-add-photo]')).toBeNull();
    expect(shareBtn()).not.toBeNull();
    expect(shareBtn().textContent).toContain('Поділитись');
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

  it('clipboard відмовляє (NotAllowedError) — фолбек execCommand спрацював тихо копіює', async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const execSpy = vi.spyOn(document, 'execCommand').mockReturnValue(true);
    await mount();
    const link = host!.querySelector<HTMLButtonElement>('[data-copy-link]')!;
    await act(async () => { link.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(execSpy).toHaveBeenCalledWith('copy');
    expect(host!.textContent).toContain('Скопійовано');
    expect(host!.querySelector('[data-copy-failed]')).toBeNull();
    execSpy.mockRestore();
  });

  it('і clipboard, і execCommand відмовляють — «Не скопіювалось — виділи й скопіюй»', async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('denied'));
    const execSpy = vi.spyOn(document, 'execCommand').mockReturnValue(false);
    await mount();
    const link = host!.querySelector<HTMLButtonElement>('[data-copy-link]')!;
    await act(async () => { link.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(host!.querySelector('[data-copy-failed]')!.textContent).toBe('Не скопіювалось — виділи й скопіюй');
    expect(host!.textContent).not.toContain('Скопійовано ✓');
    execSpy.mockRestore();
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
    selectClean();
    expect(host!.querySelector('[data-send-telegram]')).toBeNull();
    expect(host!.querySelector('[data-save-png]')).not.toBeNull();
    expect(host!.textContent).toContain('Звʼяжи Telegram у профілі');
  });

  it('телеграм звʼязаний — «Надіслати в Telegram» головною дією', async () => {
    fetchImpl = (url) => {
      if (url.startsWith('/v1/me')) return Promise.resolve(jsonRes({ user: { id: 'u1', name: 'Т', email: 't@example.com' }, household: { id: 'h1', name: 'Дім', role: 'owner', members: [] }, session_id: 's1', telegram_linked: true }));
      return defaultFetch(url);
    };
    await mount();
    selectClean();
    expect(host!.querySelector('[data-send-telegram]')).not.toBeNull();
  });

  it('без navigator.canShare (десктопний Chrome/Android) — кнопка каже «Зберегти», без окремого квадрата завантаження', async () => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
    await mount();
    selectClean();
    expect(shareBtn().textContent).toContain('Зберегти');
    expect(shareBtn().textContent).not.toContain('Поділитись');
    expect(host!.querySelector('[data-download]')).toBeNull();
  });
});

// Правка 22.09 (п.14): крапки-каруселі прибрано — перемикання кадрів тапом
// по прев'ю (тап: зсув <8px і <300мс від pointerdown до pointerup); подвійний
// тап/клік більше не скидає кроп — окрема кнопка «Скинути кадр», видима лише
// коли кроп відхилився від {scale:1,x:0.5,y:0.5}.
describe('SharePage · тап по прев\'ю перемикає кадр, «Скинути кадр» (п.14)', () => {
  function activeCanvas(): HTMLCanvasElement {
    return host!.querySelector<HTMLCanvasElement>('canvas[data-selected]')!;
  }
  function pointerTap(el: HTMLCanvasElement, x = 100, y = 100): void {
    act(() => {
      el.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
      el.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
    });
  }

  it('тап перемикає кадр по колу — той самий порядок, що мініатюри', async () => {
    await mount();
    const order = Array.from(host!.querySelectorAll('[data-thumb]')).map((el) => el.getAttribute('data-thumb'));
    expect(order.length).toBeGreaterThan(1);
    expect(activeCanvas().getAttribute('data-frame')).toBe(order[0]);
    for (let i = 1; i <= order.length; i++) {
      pointerTap(activeCanvas());
      expect(activeCanvas().getAttribute('data-frame')).toBe(order[i % order.length]);
    }
  });

  it('зсув ≥8px між pointerdown і pointerup — це drag, не тап: кадр не перемикається', async () => {
    await mount();
    const before = activeCanvas().getAttribute('data-frame');
    act(() => {
      const el = activeCanvas();
      el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1, bubbles: true }));
      el.dispatchEvent(new PointerEvent('pointerup', { clientX: 150, clientY: 100, pointerId: 1, bubbles: true }));
    });
    expect(activeCanvas().getAttribute('data-frame')).toBe(before);
  });

  it('утримання ≥300мс без зсуву — теж не тап: кадр не перемикається', async () => {
    await mount();
    const before = activeCanvas().getAttribute('data-frame');
    vi.useFakeTimers();
    try {
      act(() => {
        activeCanvas().dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1, bubbles: true }));
      });
      act(() => { vi.advanceTimersByTime(320); });
      act(() => {
        activeCanvas().dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100, pointerId: 1, bubbles: true }));
      });
    } finally {
      vi.useRealTimers();
    }
    expect(activeCanvas().getAttribute('data-frame')).toBe(before);
  });

  it('«Скинути кадр» — видима лише коли кроп не дефолтний, клік скидає рівно до {scale:1,x:0.5,y:0.5}', async () => {
    sessionStorage.setItem('share-crop:run-1', JSON.stringify({ scale: 1.8, x: 0.2, y: 0.7 }));
    fetchImpl = (url) => {
      if (url.startsWith('/v1/cook-runs')) {
        return Promise.resolve(jsonRes({
          runs: [{
            id: 'run-1', household_id: 'h1', user_id: 'u1', recipe_id: 'recipe-1', servings: 2,
            started_at: '2026-09-20T00:00:00.000Z', finished_at: '2026-09-20T00:10:00.000Z',
            rating: null, verdict: null, photo_url: '/x.jpg', changes: null, undone_at: null,
          }],
        }));
      }
      return defaultFetch(url);
    };
    await mount();
    const resetBtn = host!.querySelector<HTMLButtonElement>('[data-reset-crop="mobile"]');
    expect(resetBtn).not.toBeNull();
    act(() => { resetBtn!.click(); });
    expect(host!.querySelector('[data-reset-crop="mobile"]')).toBeNull();
    expect(JSON.parse(sessionStorage.getItem('share-crop:run-1')!)).toEqual({ scale: 1, x: 0.5, y: 0.5 });
  });

  it('«Скинути кадр» — нема, коли кроп на дефолті', async () => {
    await mount();
    expect(host!.querySelector('[data-reset-crop="mobile"]')).toBeNull();
  });
});
