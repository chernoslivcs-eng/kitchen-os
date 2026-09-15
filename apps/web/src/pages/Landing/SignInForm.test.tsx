// @vitest-environment jsdom
//
// Хотфікс 15.09 (заміна Login Widget): кнопка «Продовжити з Telegram» — лише
// коли /v1/auth/providers каже telegram: true. Клік → POST begin → відкрити
// t.me/…?start=login_<token> → опитувати GET poll раз на 2 с, поки бот не
// підтвердить (людина тисне Start у застосунку).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SignInForm } from './SignInForm';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter><SignInForm /></MemoryRouter>); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: { href: string } }).location = { href: '' };
  vi.spyOn(window, 'open').mockReturnValue({} as Window);
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const byText = (t: string) => [...host!.querySelectorAll<HTMLElement>('button, a')].find((b) => b.textContent?.includes(t));

describe('SignInForm · Telegram (хотфікс 15.09, вхід через бота)', () => {
  it('кнопки Telegram нема, коли провайдер вимкнений', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ google: false, telegram: false, telegramBotId: null })));
    await mount();
    expect(byText('Продовжити з Telegram')).toBeUndefined();
  });

  it('кнопка Telegram зʼявляється лише коли providers.telegram === true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ google: false, telegram: true, telegramBotId: '123456789' })));
    await mount();
    expect(byText('Продовжити з Telegram')).not.toBeUndefined();
  });

  it('клік (десктоп) → POST begin → window.open(t.me/…), рядок очікування замість кнопки', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url === '/v1/auth/providers') return json({ google: false, telegram: true, telegramBotId: '123456789' });
      if (url === '/v1/auth/telegram/begin') return json({ token: 'tok1', url: 'https://t.me/KitchenOSAppBot?start=login_tok1' });
      if (url.startsWith('/v1/auth/telegram/poll')) return json({ status: 'pending' });
      return json({});
    }));
    await mount();
    const btn = byText('Продовжити з Telegram')!;
    await act(async () => { btn.click(); });
    expect(calls).toContain('/v1/auth/telegram/begin');
    expect(window.open).toHaveBeenCalledWith('https://t.me/KitchenOSAppBot?start=login_tok1', '_blank', 'noopener');
    expect(host!.textContent).toContain('Відкрий Telegram і натисни Start');
    expect(byText('Продовжити з Telegram')).toBeUndefined(); // кнопка ховається, поки чекаємо
  });

  it('дотик/вузький екран: клік веде location.href на t.me, а не window.open', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/v1/auth/providers') return json({ google: false, telegram: true, telegramBotId: '123456789' });
      if (url === '/v1/auth/telegram/begin') return json({ token: 'tok2', url: 'https://t.me/KitchenOSAppBot?start=login_tok2' });
      return json({ status: 'pending' });
    }));
    await mount();
    const btn = byText('Продовжити з Telegram')!;
    await act(async () => { btn.click(); });
    expect(window.open).not.toHaveBeenCalled();
    expect(window.location.href).toBe('https://t.me/KitchenOSAppBot?start=login_tok2');
  });

  it('poll pending → ok (бот підтвердив) → редирект на /app', async () => {
    let pollCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/v1/auth/providers') return json({ google: false, telegram: true, telegramBotId: '123456789' });
      if (url === '/v1/auth/telegram/begin') return json({ token: 'tok3', url: 'https://t.me/KitchenOSAppBot?start=login_tok3' });
      if (url.startsWith('/v1/auth/telegram/poll')) { pollCalls += 1; return json({ status: pollCalls < 2 ? 'pending' : 'ok' }); }
      return json({});
    }));
    await mount();
    vi.useFakeTimers();
    const btn = byText('Продовжити з Telegram')!;
    await act(async () => { btn.click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); }); // 1-й poll: pending
    expect(window.location.href).not.toBe('/app');
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); }); // 2-й poll: ok
    expect(window.location.href).toBe('/app');
  });

  it('poll expired (токен протух чи вже спожитий) — кнопка звичайна знову, текст помилки', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/v1/auth/providers') return json({ google: false, telegram: true, telegramBotId: '123456789' });
      if (url === '/v1/auth/telegram/begin') return json({ token: 'tok4', url: 'https://t.me/KitchenOSAppBot?start=login_tok4' });
      if (url.startsWith('/v1/auth/telegram/poll')) return json({ status: 'expired' });
      return json({});
    }));
    await mount();
    vi.useFakeTimers();
    const btn = byText('Продовжити з Telegram')!;
    await act(async () => { btn.click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(host!.textContent).toContain('застаріло');
    expect(byText('Продовжити з Telegram')).not.toBeUndefined();
  });

  it('begin впав мережею — текст помилки, кнопка лишається звичайною', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/v1/auth/providers') return json({ google: false, telegram: true, telegramBotId: '123456789' });
      if (url === '/v1/auth/telegram/begin') throw new Error('network down');
      return json({});
    }));
    await mount();
    const btn = byText('Продовжити з Telegram')!;
    await act(async () => { btn.click(); });
    expect(host!.textContent).toContain('Не вийшло увійти через Telegram');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('«Не відкрилось? Ще раз» під час очікування — повторно відкриває той самий t.me-лінк', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/v1/auth/providers') return json({ google: false, telegram: true, telegramBotId: '123456789' });
      if (url === '/v1/auth/telegram/begin') return json({ token: 'tok5', url: 'https://t.me/KitchenOSAppBot?start=login_tok5' });
      if (url.startsWith('/v1/auth/telegram/poll')) return json({ status: 'pending' });
      return json({});
    }));
    await mount();
    const btn = byText('Продовжити з Telegram')!;
    await act(async () => { btn.click(); });
    vi.mocked(window.open).mockClear();
    const retry = byText('Не відкрилось? Ще раз')!;
    await act(async () => { retry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    expect(window.open).toHaveBeenCalledWith('https://t.me/KitchenOSAppBot?start=login_tok5', '_blank', 'noopener');
  });
});
