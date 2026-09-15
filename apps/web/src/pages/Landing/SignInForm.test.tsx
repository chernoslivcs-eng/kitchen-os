// @vitest-environment jsdom
//
// PR 2 (TELEGRAM-AUTH-PAY-PLAN-0915): кнопка «Продовжити з Telegram» — лише
// коли /v1/auth/providers каже telegram: true (тим самим ботом, тим самим
// провайдером, що вже ховає/показує Google). Клік → Telegram.Login.auth (тут
// замокано, бо тягне зовнішній скрипт) → POST /v1/auth/telegram/widget →
// редирект на next.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SignInForm } from './SignInForm';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./telegram-widget', () => ({
  telegramLoginAuth: vi.fn(),
  isTouchOrNarrow: vi.fn(() => false),
  buildTelegramRedirectUrl: vi.fn((botId: string) => `https://oauth.telegram.org/auth?bot_id=${botId}`),
  preloadTelegramWidget: vi.fn(),
  consumeTelegramRedirectError: vi.fn(() => false),
}));
import { telegramLoginAuth, isTouchOrNarrow, buildTelegramRedirectUrl, preloadTelegramWidget, consumeTelegramRedirectError } from './telegram-widget';

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
  vi.mocked(telegramLoginAuth).mockReset();
  vi.mocked(isTouchOrNarrow).mockReset().mockReturnValue(false);
  vi.mocked(buildTelegramRedirectUrl).mockReset().mockImplementation((botId: string) => `https://oauth.telegram.org/auth?bot_id=${botId}`);
  vi.mocked(preloadTelegramWidget).mockReset();
  vi.mocked(consumeTelegramRedirectError).mockReset().mockReturnValue(false);
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: { href: string } }).location = { href: '' };
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const byText = (t: string) => [...host!.querySelectorAll('button')].find((b) => b.textContent?.includes(t));

describe('SignInForm · Telegram', () => {
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

  it('клік → Telegram.Login.auth → POST /v1/auth/telegram/widget → редирект на next', async () => {
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/v1/auth/providers') return json({ google: false, telegram: true, telegramBotId: '123456789' });
      if (url === '/v1/auth/telegram/widget') { calls.push({ url, body: init?.body as string }); return json({ ok: true, next: '/app' }); }
      return json({});
    }));
    vi.mocked(telegramLoginAuth).mockResolvedValue({ id: 42, first_name: 'Т', auth_date: 1700000000, hash: 'deadbeef' });
    await mount();
    const btn = byText('Продовжити з Telegram')!;
    await act(async () => { btn.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(telegramLoginAuth).toHaveBeenCalledWith('123456789');
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ id: 42, hash: 'deadbeef' });
    expect(window.location.href).toBe('/app');
  });

  it('поки popup чекає підтвердження — рядок «Telegram надішле повідомлення…» під кнопкою', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/v1/auth/providers') return json({ google: false, telegram: true, telegramBotId: '123456789' });
      return json({});
    }));
    vi.mocked(telegramLoginAuth).mockReturnValue(new Promise(() => { /* висить, поки не таймаут */ }));
    await mount();
    const btn = byText('Продовжити з Telegram')!;
    await act(async () => { btn.click(); });
    expect(host!.textContent).toContain('Telegram надішле повідомлення');
    expect(byText('Зʼєднуюсь…')).not.toBeUndefined();
  });

  it('хотфікс (доповнення 15.09): 120 с без відповіді — кнопка звичайна, підказка «не прийшло? … відкрий бота» з лінком', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/v1/auth/providers') return json({ google: false, telegram: true, telegramBotId: '123456789' });
      return json({});
    }));
    vi.mocked(telegramLoginAuth).mockReturnValue(new Promise(() => { /* Telegram так і не відповів */ }));
    await mount();
    // Фейкові таймери — з моменту кліку, щоб перехопити саме 120-секундний
    // setTimeout зсередини telegramLogin (а не microtask-флаш у mount()).
    vi.useFakeTimers();
    const btn = byText('Продовжити з Telegram')!;
    await act(async () => { btn.click(); });
    expect(host!.textContent).toContain('Telegram надішле повідомлення');

    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });

    expect(host!.textContent).not.toContain('Telegram надішле повідомлення');
    expect(host!.textContent).toContain('Не прийшло?');
    const link = host!.querySelector('a[href="https://t.me/KitchenOSAppBot"]');
    expect(link?.textContent).toBe('t.me/KitchenOSAppBot');
    // Кнопка повернулась у звичайний стан і знову клікабельна.
    expect(byText('Продовжити з Telegram')).not.toBeUndefined();
    expect((byText('Продовжити з Telegram') as HTMLButtonElement).disabled).toBe(false);
  });

  it('десктоп (isTouchOrNarrow: false): скрипт віджета підвантажується заздалегідь, popup-гілка без змін', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/v1/auth/providers') return json({ google: false, telegram: true, telegramBotId: '123456789' });
      return json({});
    }));
    await mount();
    expect(preloadTelegramWidget).toHaveBeenCalled();
    expect(buildTelegramRedirectUrl).not.toHaveBeenCalled();
  });

  it('дотик/вузький екран (хотфікс 15.09): клік не чіпає Telegram.Login.auth, а веде на редирект-URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/v1/auth/providers') return json({ google: false, telegram: true, telegramBotId: '123456789' });
      return json({});
    }));
    vi.mocked(isTouchOrNarrow).mockReturnValue(true);
    await mount();
    expect(preloadTelegramWidget).not.toHaveBeenCalled();
    const btn = byText('Продовжити з Telegram')!;
    await act(async () => { btn.click(); });
    expect(telegramLoginAuth).not.toHaveBeenCalled();
    expect(buildTelegramRedirectUrl).toHaveBeenCalledWith('123456789');
    expect(window.location.href).toBe('https://oauth.telegram.org/auth?bot_id=123456789');
  });

  it('/auth/telegram повернув ?tgError=1 — той самий текст помилки, що в попап-гілці', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/v1/auth/providers') return json({ google: false, telegram: true, telegramBotId: '123456789' });
      return json({});
    }));
    vi.mocked(consumeTelegramRedirectError).mockReturnValue(true);
    await mount();
    expect(host!.textContent).toContain('Не вийшло увійти через Telegram');
  });

  it('людина закриває вікно Telegram (колбек false) — тихо, без помилки й без запиту на сервер', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/v1/auth/providers') return json({ google: false, telegram: true, telegramBotId: '123456789' });
      calls.push(url);
      return json({});
    }));
    vi.mocked(telegramLoginAuth).mockResolvedValue(null);
    await mount();
    const btn = byText('Продовжити з Telegram')!;
    await act(async () => { btn.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(calls).toHaveLength(0);
    expect(host!.textContent).not.toContain('Не вийшло увійти через Telegram');
  });
});
