// @vitest-environment jsdom
// Постановка 2026-09-25, Task 11: три кейси — null (active/beta/без рядка),
// банер з кнопкою (lapsed/past_due), банер без кнопки (cancelled, trial).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SubscriptionBanner } from './SubscriptionBanner';
import { useAuth } from '../../store/auth';
import type { Me } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function meWith(subscription: Me['subscription']): Me {
  return {
    user: { id: 'u1', name: 'Т', email: 't@x.test' },
    household: { id: 'h1', name: 'Дім', role: 'owner', members: [] },
    session_id: 's1',
    subscription,
  };
}

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter><SubscriptionBanner /></MemoryRouter>); });
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = undefined;
  host = undefined;
  useAuth.setState({ me: null });
  vi.unstubAllGlobals();
});

describe('SubscriptionBanner', () => {
  it('banner: null (active/beta/без рядка) — нічого не малює', async () => {
    useAuth.setState({ me: meWith({ state: 'active', plan: 'self', entitlement: 'full', trial_ends_at: null, next_charge_at: null, access_until: null, card_mask: '4242', banner: null }) });
    await mount();
    expect(host!.querySelector('[role="status"]')).toBeNull();
    expect(host!.textContent).toBe('');
  });

  it('banner з кнопкою (lapsed) — текст і посилання', async () => {
    useAuth.setState({ me: meWith({ state: 'lapsed', plan: null, entitlement: 'read_only', trial_ends_at: null, next_charge_at: null, access_until: null, card_mask: null, banner: { text: 'Підписка закінчилась — усе лишив як було.', cta: 'Продовжити', to: '/profile/subscription' } }) });
    await mount();
    expect(host!.querySelector('[role="status"]')?.textContent).toContain('Підписка закінчилась — усе лишив як було.');
    const link = host!.querySelector<HTMLAnchorElement>('a[href="/profile/subscription"]');
    expect(link?.textContent).toBe('Продовжити');
  });

  it('banner без кнопки (cancelled, немає to) — лише текст, посилання нема', async () => {
    useAuth.setState({ me: meWith({ state: 'cancelled', plan: 'home', entitlement: 'full', trial_ends_at: null, next_charge_at: null, access_until: '2026-10-15T00:00:00Z', card_mask: '4242', banner: { text: 'До 15 жовтня все працює як завжди. Потім просто зробимо паузу.' } }) });
    await mount();
    expect(host!.querySelector('[role="status"]')?.textContent).toContain('До 15 жовтня');
    expect(host!.querySelector('a')).toBeNull();
  });

  it('past_due — бурштиновий клас', async () => {
    useAuth.setState({ me: meWith({ state: 'past_due', plan: 'self', entitlement: 'full', trial_ends_at: null, next_charge_at: '2026-09-20T00:00:00Z', access_until: null, card_mask: '4242', banner: { text: 'Цього разу оплата не пройшла. Оновимо картку й продовжимо звідси.', cta: 'Оновити картку', to: '/profile/subscription' } }) });
    await mount();
    const bar = host!.querySelector('[role="status"]');
    // CSS-модулі у vitest — порожній обʼєкт; клас застосований, якщо є
    // ХОЧ ЯКЕ друге слово в className (амбер-варіант), не ім'я токена.
    expect(bar?.className.trim().split(/\s+/).length).toBeGreaterThan(1);
  });
});
