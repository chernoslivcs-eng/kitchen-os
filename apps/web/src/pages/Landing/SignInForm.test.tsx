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
}));
import { telegramLoginAuth } from './telegram-widget';

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
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: { href: string } }).location = { href: '' };
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.unstubAllGlobals();
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
