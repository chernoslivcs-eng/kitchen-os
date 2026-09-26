// @vitest-environment jsdom
// Постановка 2026-09-25 (режим без підписки), Task 12: /profile/subscription —
// по одному кейсу на стан (верхній рядок і кнопки, спек §4), плюс «Скасувати»
// → аркуш → підтвердження → api.subscription.cancel; «Оформити» →
// window.location.assign(url); «Змінити тариф» пониження показує effective_at.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SubscriptionPage } from './Subscription';
import { useAuth } from '../../store/auth';
import type { Me } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

const ME: Me = {
  user: { id: 'u1', name: 'Пилип', email: 'me@x.test' },
  household: { id: 'h1', name: 'Дім', role: 'owner', members: [{ user_id: 'u1', name: 'Пилип', role: 'owner', joined_at: '2026-01-01T00:00:00Z' }] },
  session_id: 's1',
};

function sub(over: Partial<NonNullable<Me['subscription']>>): NonNullable<Me['subscription']> {
  return { state: 'active', plan: 'home', entitlement: 'full', trial_ends_at: null, next_charge_at: null, access_until: null, card_mask: null, banner: null, ...over };
}

let calls: { url: string; method: string; body: unknown }[];
let getResponse: { subscription: NonNullable<Me['subscription']>; payments: unknown[] };
let postHandlers: Record<string, () => Response>;

function installFetch() {
  calls = [];
  postHandlers = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    if (url === '/v1/subscription' && method === 'GET') return json(getResponse);
    if (postHandlers[url]) return postHandlers[url]();
    return json({});
  }));
}

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter><SubscriptionPage /></MemoryRouter>); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  useAuth.setState({ me: ME });
  installFetch();
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = undefined;
  host = undefined;
  vi.unstubAllGlobals();
  delete (window as unknown as { location?: unknown }).location;
});

describe('Екран «Підписка» — верхній рядок і кнопки за станом (спек §4)', () => {
  it('beta — без кнопок', async () => {
    getResponse = { subscription: sub({ state: 'beta', plan: null }), payments: [] };
    await mount();
    expect(host!.textContent).toContain('Бета-тест · усе безкоштовно');
    expect(host!.querySelector('button')).toBeNull();
  });

  it('trial — дата й сума, лише «Скасувати»', async () => {
    getResponse = { subscription: sub({ state: 'trial', plan: 'home', trial_ends_at: '2026-10-09T00:00:00Z', card_mask: '4242' }), payments: [] };
    await mount();
    expect(host!.textContent).toContain('Пробний до 09.10 · далі 290 ₴/міс');
    expect(host!.textContent).toContain('картка •• 4242');
    expect(host!.textContent).toContain('Скасувати');
    expect(host!.textContent).not.toContain('Змінити тариф');
  });

  it('active — тариф, наступне списання, «Змінити тариф» + «Скасувати»', async () => {
    getResponse = { subscription: sub({ state: 'active', plan: 'home', next_charge_at: '2026-10-12T00:00:00Z', card_mask: '4242' }), payments: [] };
    await mount();
    expect(host!.textContent).toContain('Для дому · наступне списання 12.10, 290 ₴');
    expect(host!.textContent).toContain('Змінити тариф');
    expect(host!.textContent).toContain('Скасувати');
  });

  it('cancelled — доступ до дати, «Продовжити»', async () => {
    getResponse = { subscription: sub({ state: 'cancelled', plan: 'self', access_until: '2026-10-12T00:00:00Z' }), payments: [] };
    await mount();
    expect(host!.textContent).toContain('Скасовано · доступ до 12.10');
    expect(host!.textContent).toContain('Продовжити');
    expect(host!.textContent).not.toContain('Скасувати');
  });

  it('past_due — списання не пройшло, «Оновити картку»', async () => {
    getResponse = { subscription: sub({ state: 'past_due', plan: 'self', next_charge_at: '2026-09-12T00:00:00Z', card_mask: '4242' }), payments: [] };
    await mount();
    expect(host!.textContent).toContain('Списання 12.09 не пройшло');
    expect(host!.textContent).toContain('Оновити картку');
  });

  it('lapsed — дві картки тарифів, без «Бета-тест», кожна з «Оформити»', async () => {
    getResponse = { subscription: sub({ state: 'lapsed', plan: null, access_until: '2026-09-18T00:00:00Z' }), payments: [] };
    await mount();
    expect(host!.textContent).toContain('Підписка закінчилась 18.09 · дані на місці');
    expect(host!.textContent).not.toContain('Бета-тест');
    const btns = [...host!.querySelectorAll('button')].filter((b) => b.textContent?.includes('Оформити'));
    expect(btns).toHaveLength(2);
  });

  it('lapsed без дат (дім ніколи не мав підписки) — без «закінчилась», лише «дані на місці»', async () => {
    getResponse = { subscription: sub({ state: 'lapsed', plan: null }), payments: [] };
    await mount();
    expect(host!.textContent).toContain('Дані на місці');
    expect(host!.textContent).not.toContain('закінчилась');
  });
});

describe('«Скасувати» — аркуш, підтвердження, api.subscription.cancel', () => {
  it('відкриває аркуш, «Скасувати підписку» викликає cancel, оновлює стан', async () => {
    getResponse = { subscription: sub({ state: 'active', plan: 'home', next_charge_at: '2026-10-12T00:00:00Z' }), payments: [] };
    postHandlers['/v1/subscription/cancel'] = () => json({ subscription: sub({ state: 'cancelled', plan: 'home', access_until: '2026-10-12T00:00:00Z' }) });
    await mount();

    const cancelBtn = [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Скасувати')!;
    await act(async () => { cancelBtn.click(); });
    expect(host!.textContent).toContain('Доступ лишиться до 12.10, далі — тільки читати. Дані не видаляємо.');

    const confirm = [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Скасувати підписку')!;
    await act(async () => { confirm.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(calls.some((c) => c.url === '/v1/subscription/cancel' && c.method === 'POST')).toBe(true);
    expect(host!.textContent).toContain('Скасовано · доступ до 12.10');
  });

  it('«Лишити» закриває аркуш без виклику cancel', async () => {
    getResponse = { subscription: sub({ state: 'trial', plan: 'self', trial_ends_at: '2026-10-09T00:00:00Z' }), payments: [] };
    await mount();
    const cancelBtn = [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Скасувати')!;
    await act(async () => { cancelBtn.click(); });
    const stay = [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Лишити')!;
    await act(async () => { stay.click(); });
    expect(calls.some((c) => c.url === '/v1/subscription/cancel')).toBe(false);
  });
});

describe('«Оформити» (lapsed) — checkout і редирект', () => {
  it('клік → POST /v1/subscription/checkout {plan} → window.location.assign(url)', async () => {
    getResponse = { subscription: sub({ state: 'lapsed', plan: null }), payments: [] };
    postHandlers['/v1/subscription/checkout'] = () => json({ url: 'https://pay.example.test/checkout/abc' });
    delete (window as unknown as { location?: unknown }).location;
    (window as unknown as { location: { assign: (u: string) => void } }).location = { assign: vi.fn() };
    await mount();

    const btns = [...host!.querySelectorAll('button')].filter((b) => b.textContent?.includes('Оформити'));
    await act(async () => { btns[0]!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const checkoutCall = calls.find((c) => c.url === '/v1/subscription/checkout');
    expect(checkoutCall?.body).toMatchObject({ plan: 'self' });
    expect(window.location.assign).toHaveBeenCalledWith('https://pay.example.test/checkout/abc');
  });
});

describe('«Змінити тариф» — пониження показує effective_at', () => {
  it('обираєш «Для себе» (поточний — «Для дому») → «З {дата}. До того — як зараз.», «Змінити» → setPlan', async () => {
    getResponse = { subscription: sub({ state: 'active', plan: 'home', next_charge_at: '2026-10-12T00:00:00Z' }), payments: [] };
    postHandlers['/v1/subscription/plan'] = () => json({ subscription: sub({ state: 'active', plan: 'self', next_charge_at: '2026-10-12T00:00:00Z' }), effective_at: '2026-10-12T00:00:00Z' });
    await mount();

    const openBtn = [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Змінити тариф')!;
    await act(async () => { openBtn.click(); });

    const selfCard = [...host!.querySelectorAll('button')].find((b) => b.textContent?.includes('Для себе') && b.textContent?.includes('210'))!;
    await act(async () => { selfCard.click(); });
    expect(host!.textContent).toContain('З 12.10. До того — як зараз.');

    const confirm = [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Змінити')!;
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { confirm.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const planCall = calls.find((c) => c.url === '/v1/subscription/plan');
    expect(planCall?.body).toMatchObject({ plan: 'self' });
  });

  it('поточний тариф вибраний за замовчуванням — «Змінити» вимкнена, поки не обрано інший', async () => {
    getResponse = { subscription: sub({ state: 'active', plan: 'home', next_charge_at: '2026-10-12T00:00:00Z' }), payments: [] };
    await mount();
    const openBtn = [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Змінити тариф')!;
    await act(async () => { openBtn.click(); });
    const confirm = [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Змінити')! as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });
});

describe('Історія списань', () => {
  it('рядки: дата, сума, статус, хто платив, квитанція; невдале — без посилання', async () => {
    getResponse = {
      subscription: sub({ state: 'active', plan: 'home', next_charge_at: '2026-10-12T00:00:00Z' }),
      payments: [
        { id: 'p1', household_id: 'h1', amount: 290, currency: 'UAH', status: 'success', provider_payment_id: 'o1', paid_by_user_id: 'u1', receipt_url: 'https://x.test/r1', created_at: '2026-09-12T00:00:00Z' },
        { id: 'p2', household_id: 'h1', amount: 290, currency: 'UAH', status: 'failure', provider_payment_id: 'o2', paid_by_user_id: 'u1', receipt_url: null, created_at: '2026-08-12T00:00:00Z' },
      ],
    };
    await mount();
    expect(host!.textContent).toContain('Історія списань');
    const rows = [...host!.querySelectorAll('li')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('12.09');
    expect(rows[0]!.textContent).toContain('290 ₴');
    expect(rows[0]!.textContent).toContain('сплачено');
    expect(rows[0]!.textContent).toContain('Пилип');
    expect(rows[0]!.querySelector('a')).not.toBeNull();
    expect(rows[1]!.textContent).toContain('не пройшло');
    expect(rows[1]!.querySelector('a')).toBeNull();
  });

  it('trial без платежів — секції історії нема', async () => {
    getResponse = { subscription: sub({ state: 'trial', plan: 'self', trial_ends_at: '2026-10-09T00:00:00Z' }), payments: [] };
    await mount();
    expect(host!.textContent).not.toContain('Історія списань');
  });
});
