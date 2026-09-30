// @vitest-environment jsdom
// Хотфікс 29.09: стара вкладка після деплою просить чанк зі старим хешем.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installPreloadErrorHandler, RELOAD_WINDOW_MS, PRELOAD_BANNER_TEXT } from './preload-error';

const fire = () => window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));

describe('vite:preloadError', () => {
  // Слухач вішається на window, спільне для всіх тестів — без відписки другий
  // тест ловив би подію обробником першого й падав не там, де здається.
  let off: (() => void) | undefined;
  beforeEach(() => { sessionStorage.clear(); });
  afterEach(() => { off?.(); off = undefined; vi.unstubAllGlobals(); });

  it('перший раз — перезавантажуємо сторінку', () => {
    const reload = vi.fn(); const banner = vi.fn();
    off = installPreloadErrorHandler({ now: () => 1_000_000, reload, banner });
    fire();
    expect(reload).toHaveBeenCalledOnce();
    expect(banner).not.toHaveBeenCalled();
  });

  it('другий раз за хвилину — НЕ перезавантажуємо, а кажемо людині', () => {
    const reload = vi.fn(); const banner = vi.fn();
    let t = 1_000_000;
    off = installPreloadErrorHandler({ now: () => t, reload, banner });
    fire();
    expect(reload).toHaveBeenCalledOnce();

    // Та сама вкладка через півхвилини: перезавантаження не допомогло.
    t += RELOAD_WINDOW_MS / 2;
    fire();
    expect(reload).toHaveBeenCalledOnce();      // другого разу не було
    expect(banner).toHaveBeenCalledWith(PRELOAD_BANNER_TEXT);
  });

  it('через хвилину — знову можна: це вже інший деплой, а не цикл', () => {
    const reload = vi.fn(); const banner = vi.fn();
    let t = 1_000_000;
    off = installPreloadErrorHandler({ now: () => t, reload, banner });
    fire();
    t += RELOAD_WINDOW_MS + 1;
    fire();
    expect(reload).toHaveBeenCalledTimes(2);
    expect(banner).not.toHaveBeenCalled();
  });

  it('подію гасимо: інакше Vite кине її далі й вона полетить як падіння', () => {
    off = installPreloadErrorHandler({ now: () => 1, reload: vi.fn(), banner: vi.fn() });
    const ev = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('sessionStorage недоступний (приватний режим) — не падаємо', () => {
    const reload = vi.fn();
    vi.stubGlobal('sessionStorage', {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    });
    off = installPreloadErrorHandler({ now: () => 1_000_000, reload, banner: vi.fn() });
    expect(() => fire()).not.toThrow();
    expect(reload).toHaveBeenCalledOnce();
  });
});
