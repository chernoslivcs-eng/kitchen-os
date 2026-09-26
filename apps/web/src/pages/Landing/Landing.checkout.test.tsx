// @vitest-environment jsdom
// Постановка 2026-09-25 (біллінг LiqPay) Task 7: секція «Ціна» при
// !BETA_PLAN — кнопка картки тарифу викликає POST /v1/billing/intent і
// редиректить на checkout, зберігши order_id у localStorage ДО того.
// BETA_PLAN — літерал у copy.ts, не env: мокаємо модуль на buildPlans(false)
// (той самий прийом, що copy.test.ts використовує напряму, тут — через
// vi.mock, бо перевіряємо саму сторінку, не PLANS-шейп).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

vi.mock('./copy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./copy')>();
  return { ...actual, BETA_PLAN: false, PLANS: actual.buildPlans(false) };
});

const { Landing } = await import('./Landing');

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let intentCalls: { plan?: string }[];

function installFetch() {
  intentCalls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/v1/billing/intent') {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      intentCalls.push(body);
      return json({ url: 'https://www.liqpay.ua/api/3/checkout?data=x&signature=y', order_id: 'ord-checkout-1' });
    }
    if (url === '/v1/auth/providers') return json({ google: false, telegram: false, telegramBotId: null });
    return json({});
  }));
}

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter><Landing /></MemoryRouter>); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  localStorage.clear();
  installFetch();
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: { assign: (u: string) => void } }).location = { assign: vi.fn() };
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.unstubAllGlobals();
});

describe('Landing · checkout з картки тарифу (!BETA_PLAN)', () => {
  it('клік на «До банку» — intent({plan}), order_id у localStorage, редирект на url', async () => {
    await mount();
    const buttons = [...host!.querySelectorAll('button')].filter((b) => b.textContent?.includes('До банку'));
    expect(buttons.length).toBeGreaterThan(0);

    await act(async () => { buttons[0]!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(intentCalls).toHaveLength(1);
    expect(['self', 'home']).toContain(intentCalls[0]!.plan);
    expect(localStorage.getItem('kos_intent')).toBe('ord-checkout-1');
    expect(window.location.assign).toHaveBeenCalledWith('https://www.liqpay.ua/api/3/checkout?data=x&signature=y');
  });

  it('нема карток «Бета-тест» і сірих пігулок «після бети» — усі кнопки активні', async () => {
    await mount();
    expect(host!.textContent).not.toContain('Бета-тест');
    expect(host!.textContent).not.toContain('після бети');
  });
});
