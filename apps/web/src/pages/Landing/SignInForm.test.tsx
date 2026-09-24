// @vitest-environment jsdom
//
// Хотфікс 15.09 (заміна Login Widget): кнопка «Продовжити з Telegram» — лише
// коли /v1/auth/providers каже telegram: true. Клік → POST begin → відкрити
// t.me/…?start=login_<token> → опитувати GET poll раз на 2 с, поки бот не
// підтвердить (людина тисне Start у застосунку).
//
// Бриф 24.09 (Sign-in Compact): тариф і перелік способів прибрано з режиму
// «Реєстрація»; підтвердження надсилання — інлайн (зелена пігулка), не
// перехід на /sent; підказка в полі коротшає на компактній ширині.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SignInForm } from './SignInForm';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

let root: Root | undefined;
let host: HTMLDivElement | undefined;

// matchMedia — SignInForm тепер слухає (pointer: coarse) (isTouchOrNarrow,
// імперативно на клік) і (max-width: 479px) (useCompact, реактивно на монтуванні):
// обом треба addEventListener/removeEventListener, інакше падіння при mount.
let mediaOverrides: Record<string, boolean> = {};
function fakeMediaQueryList(query: string): MediaQueryList {
  return {
    matches: mediaOverrides[query] ?? false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;
}

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
  mediaOverrides = {};
  vi.spyOn(window, 'matchMedia').mockImplementation(fakeMediaQueryList);
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const byText = (t: string) => [...host!.querySelectorAll<HTMLElement>('button, a')].find((b) => b.textContent?.includes(t));
const emailInput = () => host!.querySelector<HTMLInputElement>('input[type="email"]')!;
function setEmailValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function submitForm(el: HTMLInputElement) {
  el.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

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
    mediaOverrides['(pointer: coarse)'] = true;
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

// ── AUTH-BRIEF-0915: «Реєстрація / Вхід» ─────────────────────────────────────
describe('SignInForm · «Реєстрація / Вхід» (AUTH-BRIEF-0915)', () => {
  const providersOn = () => json({ google: true, telegram: true, telegramBotId: '123456789' });

  it('дефолт без kos-had-session — «Реєстрація»; тарифів і роздільника нема (бриф 24.09)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/v1/auth/providers' ? providersOn() : json({}))));
    await mount();
    const start = byText('Реєстрація')!;
    const login = byText('Вхід')!;
    expect(start.getAttribute('aria-selected')).toBe('true');
    expect(login.getAttribute('aria-selected')).toBe('false');
    expect(host!.textContent).not.toContain('Бета-тест');
    expect(host!.textContent).not.toContain('Тариф');
    expect(host!.textContent).not.toContain('або лінк на пошту');
    expect(host!.textContent).toContain('Зараз безкоштовно, поки триває бета');
  });

  it('kos-had-session у localStorage — дефолт «Вхід»', async () => {
    localStorage.setItem('kos-had-session', '1');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/v1/auth/providers' ? providersOn() : json({}))));
    await mount();
    expect(byText('Вхід')!.getAttribute('aria-selected')).toBe('true');
    expect(host!.textContent).toContain('Тим способом, яким заходив раніше');
  });

  it('перемикач міняє текст note між режимами', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/v1/auth/providers' ? providersOn() : json({}))));
    await mount();
    expect(host!.textContent).toContain('Зараз безкоштовно, поки триває бета');
    await act(async () => { byText('Вхід')!.click(); });
    expect(host!.textContent).toContain('Тим способом, яким заходив раніше');
    await act(async () => { byText('Реєстрація')!.click(); });
    expect(host!.textContent).toContain('Зараз безкоштовно, поки триває бета');
  });

  it('рядок згоди (умови/політика) видно і в «Реєстрація», і в «Вхід» (§2.5)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/v1/auth/providers' ? providersOn() : json({}))));
    await mount();
    expect(host!.textContent).toContain('Реєструючись, ти приймаєш');
    await act(async () => { byText('Вхід')!.click(); });
    expect(host!.textContent).toContain('Реєструючись, ти приймаєш');
  });

  it('Telegram begin шле mode:login у тілі запиту, коли обрано «Вхід»', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/v1/auth/providers') return providersOn();
      if (url === '/v1/auth/telegram/begin') { bodies.push(init?.body as string); return json({ token: 't', url: 'https://t.me/KitchenOSAppBot?start=login_t' }); }
      return json({ status: 'pending' });
    }));
    await mount();
    await act(async () => { byText('Вхід')!.click(); });
    await act(async () => { byText('Продовжити з Telegram')!.click(); });
    expect(JSON.parse(bodies[0]!)).toEqual({ mode: 'login' });
  });

  it('Google-кнопка веде на /v1/auth/google?mode=login, коли обрано «Вхід»', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/v1/auth/providers' ? providersOn() : json({}))));
    await mount();
    await act(async () => { byText('Вхід')!.click(); });
    await act(async () => { byText('Продовжити з Google')!.click(); });
    expect(window.location.href).toBe('/v1/auth/google?mode=login');
  });

  it('Google-кнопка веде на /v1/auth/google (без mode) у «Реєстрація»', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/v1/auth/providers' ? providersOn() : json({}))));
    await mount();
    await act(async () => { byText('Продовжити з Google')!.click(); });
    expect(window.location.href).toBe('/v1/auth/google');
  });

  it('«Вхід» + невідома пошта ({error:no_account}) — рядок-note, «Зареєструватись» повертає в «Реєстрація»', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/v1/auth/providers') return json({ google: false, telegram: false, telegramBotId: null });
      if (url === '/v1/auth/request') return json({ error: 'no_account' });
      return json({});
    }));
    await mount();
    await act(async () => { byText('Вхід')!.click(); });
    await act(async () => { setEmailValue(emailInput(), 'nobody@example.com'); });
    await act(async () => { submitForm(emailInput()); });
    expect(host!.textContent).toContain('Цієї пошти ми ще не знаємо');
    await act(async () => { byText('Зареєструватись')!.click(); });
    expect(host!.textContent).not.toContain('Цієї пошти ми ще не знаємо');
    expect(byText('Реєстрація')!.getAttribute('aria-selected')).toBe('true');
  });

  it('«Вхід» + Telegram poll no_account — рядок-note телеграма, кнопка знову звичайна', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/v1/auth/providers') return providersOn();
      if (url === '/v1/auth/telegram/begin') return json({ token: 'tokna', url: 'https://t.me/KitchenOSAppBot?start=login_tokna' });
      if (url.startsWith('/v1/auth/telegram/poll')) return json({ status: 'no_account' });
      return json({});
    }));
    await mount();
    vi.useFakeTimers();
    await act(async () => { byText('Вхід')!.click(); });
    await act(async () => { byText('Продовжити з Telegram')!.click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(host!.textContent).toContain('Цього Telegram ми ще не знаємо');
    expect(byText('Продовжити з Telegram')).not.toBeUndefined();
  });

  it('редирект від Google (?err=no_account&via=google) — режим «Вхід», note google, адреса очищена', async () => {
    (window as unknown as { location: { href: string; search: string; pathname: string; hash: string } }).location = {
      href: 'http://localhost/?err=no_account&via=google', search: '?err=no_account&via=google', pathname: '/', hash: '',
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/v1/auth/providers' ? providersOn() : json({}))));
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    await mount();
    expect(byText('Вхід')!.getAttribute('aria-selected')).toBe('true');
    expect(host!.textContent).toContain('Цього Google-акаунта ми ще не знаємо');
    expect(replaceSpy).toHaveBeenCalled();
  });
});

// ── Бриф 24.09 (Sign-in Compact §2.4, §2.6): підказка, підтвердження, помилка ──
describe('SignInForm · компактне поле пошти (бриф 24.09)', () => {
  it('плейсхолдер повний на звичайній ширині, короткий на <480 (§2.4)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/v1/auth/providers' ? json({ google: false, telegram: false, telegramBotId: null }) : json({}))));
    await mount();
    expect(emailInput().placeholder).toBe('Або пошта — пришлемо лінк');
  });

  it('надсилання успішне → інлайн-пігулка «Лист на … надіслано», не перехід на /sent (§2.6)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/v1/auth/providers') return json({ google: false, telegram: false, telegramBotId: null });
      if (url === '/v1/auth/request') return json({ ok: true });
      return json({});
    }));
    await mount();
    await act(async () => { setEmailValue(emailInput(), 'me@example.com'); });
    await act(async () => { submitForm(emailInput()); });
    expect(host!.textContent).toContain('Лист на me@example.com надіслано');
    expect(host!.textContent).toContain('Відкрий пошту й натисни лінк');
    expect(host!.querySelector('input[type="email"]')).toBeNull(); // поле зникло, не /sent-навігація
    expect(window.location.href).toBe(''); // жодної навігації не сталось
  });

  it('«Ще раз» на підтвердженні повторно шле лист на ту саму адресу', async () => {
    const requests: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/v1/auth/providers') return json({ google: false, telegram: false, telegramBotId: null });
      if (url === '/v1/auth/request') { requests.push(init?.body); return json({ ok: true }); }
      return json({});
    }));
    await mount();
    await act(async () => { setEmailValue(emailInput(), 'me@example.com'); });
    await act(async () => { submitForm(emailInput()); });
    expect(requests).toHaveLength(1);
    await act(async () => { byText('Ще раз')!.click(); });
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[1] as string)).toMatchObject({ email: 'me@example.com' });
  });

  it('збій сервера (не 429) — дружній текст замість сирого err.message, кнопка «Ще раз» у пігулці', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/v1/auth/providers') return json({ google: false, telegram: false, telegramBotId: null });
      if (url === '/v1/auth/request') return new Response(JSON.stringify({ error: 'boom internal detail' }), { status: 500 });
      return json({});
    }));
    await mount();
    await act(async () => { setEmailValue(emailInput(), 'me@example.com'); });
    await act(async () => { submitForm(emailInput()); });
    expect(host!.textContent).toContain('Лист не пішов — пошта зараз не відповідає');
    expect(host!.textContent).not.toContain('boom internal detail');
    expect(byText('Ще раз')).not.toBeUndefined();
  });
});
