// @vitest-environment jsdom
//
// Хотфікс (15.09, прод): /auth/telegram — куди oauth.telegram.org повертає
// після редирект-флоу на дотикових екранах (SignInForm.tsx/telegram-widget.ts).
// Query несе ті самі поля, що popup-колбек Telegram.Login.auth, тому маршрут
// просто розбирає їх і б'є в POST /v1/auth/telegram/widget — так само, як
// popup-гілка робить напряму з обʼєкта.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthTelegramPage } from './AuthTelegram';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function mount(search: string) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[`/auth/telegram${search}`]}>
        <Routes>
          <Route path="/auth/telegram" element={<AuthTelegramPage />} />
          <Route path="/" element={<div>лендінг</div>} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: { href: string; search: string } }).location = { href: '', search: '' };
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.unstubAllGlobals();
});

describe('AuthTelegramPage', () => {
  it('розбирає query → POST /v1/auth/telegram/widget із тими самими полями → редирект на next', async () => {
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string });
      return json({ ok: true, next: '/app' });
    }));
    await mount('?id=42&first_name=%D0%A2&username=testuser&auth_date=1700000000&hash=deadbeef');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/v1/auth/telegram/widget');
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ id: 42, first_name: 'Т', username: 'testuser', auth_date: 1700000000, hash: 'deadbeef' });
    expect(window.location.href).toBe('/app');
  });

  it('сервер відмовив (403 — підроблений hash чи протухлий лінк) → назад на лендінг з ?tgError=1', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'bad signature' }, 403)));
    await mount('?id=42&first_name=%D0%A2&auth_date=1700000000&hash=forged');
    expect(host!.textContent).toContain('лендінг');
  });

  it('бракує обовʼязкового поля в query (немає hash) — одразу на лендінг з ?tgError=1, без запиту', async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    await mount('?id=42&first_name=%D0%A2&auth_date=1700000000');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host!.textContent).toContain('лендінг');
  });
});
