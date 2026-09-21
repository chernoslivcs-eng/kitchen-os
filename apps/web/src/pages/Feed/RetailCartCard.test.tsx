// @vitest-environment jsdom
// 21.09 (рішення власника): картка кошика — чернетка. «Оформити в Сільпо» — кнопка:
// вкладка відкривається синхронно до await, commit, після ok у вкладку ставиться
// cart_url; помилка → вкладку закрито, текст у картці. Після commit: лінк «Відкрити
// кошик Сільпо», степер/заміна заблоковані з підписом, рядки з failed позначені.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { RetailCartCard } from './cards';
import type { ChatCard } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined; let host: HTMLDivElement | undefined;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const product = (id: string, name: string, price: number) => ({ product_id: id, company_id: 'c1', branch_id: 'b1', name, price, weighted: false, quantity: 1, package_ml: null });
const draft = (): ChatCard => ({
  type: 'cart', provider: 'silpo', list_label: null, cart_url: 'https://silpo.ua', committed: false,
  rows: [
    { label: 'рис', item_id: null, v: null, u: null, product: product('id-rice', 'Рис круглий', 40), alternatives: [{ ...product('id-basmati', 'Рис басматі', 90) }] },
    { label: 'лосось', item_id: null, v: null, u: null, product: product('id-salmon', 'Лосось', 500), alternatives: [] },
  ],
  total: 540, found: 2, of: 2,
} as unknown as ChatCard);

let tab: { location: { href: string }; close: ReturnType<typeof vi.fn> };
beforeEach(() => {
  tab = { location: { href: '' }, close: vi.fn() };
  vi.stubGlobal('open', vi.fn(() => tab));
});
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); vi.unstubAllGlobals(); });

async function mount(card: ChatCard) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter><RetailCartCard card={card} cardId="card-1" /></MemoryRouter>); });
}
const click = (sel: string) => act(async () => { host!.querySelector<HTMLButtonElement>(sel)!.click(); await new Promise((r) => setTimeout(r, 0)); });

describe('RetailCartCard · чернетка → commit', () => {
  it('чернетка: кнопка «Оформити», степер активний, без попередження про стару позицію', async () => {
    await mount(draft());
    expect(host!.querySelector('[data-cart-commit]')).not.toBeNull();
    expect(host!.querySelector('[data-cart-open]')).toBeNull();
    expect(host!.textContent).toContain('ЧЕРНЕТКА');
    expect(host!.textContent).not.toContain('стару доведеться прибрати');
    expect(host!.querySelector<HTMLButtonElement>('button[aria-label="більше"]')!.disabled).toBe(false);
  });

  it('«Оформити»: вкладка відкрита синхронно, після ok — cart_url у вкладці, картка committed, лінк «Відкрити кошик», степер заблоковано з підписом', async () => {
    const committed = { ...draft(), committed: true, committed_at: '2026-09-21T10:00:00Z', failed: [] };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/v1/retail/cart/commit' ? json({ ok: true, card: committed, card_id: 'card-1', failed: [] }) : json({}))));
    await mount(draft());
    await click('[data-cart-commit]');
    expect(window.open).toHaveBeenCalledWith('', '_blank');
    expect(tab.location.href).toBe('https://silpo.ua');
    expect(tab.close).not.toHaveBeenCalled();
    expect(host!.querySelector('[data-cart-open]')?.getAttribute('href')).toBe('https://silpo.ua');
    expect(host!.querySelector('[data-cart-commit]')).toBeNull();
    expect(host!.querySelector<HTMLButtonElement>('button[aria-label="більше"]')!.disabled).toBe(true);
    expect(host!.querySelectorAll('[data-cart-locked]').length).toBe(2);
    expect(host!.textContent).toContain('уже в кошику Сільпо');
    expect(host!.querySelector('[aria-expanded]')).toBeNull();          // заміни нема
  });

  it('помилка commit: вкладку закрито, помилка в картці, кнопка лишається', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'not_connected' }, 409)));
    await mount(draft());
    await click('[data-cart-commit]');
    expect(tab.close).toHaveBeenCalled();
    expect(host!.querySelector('[data-cart-error]')).not.toBeNull();
    expect(host!.querySelector('[data-cart-commit]')).not.toBeNull();
  });

  it('часткова невдача: рядки з failed позначені, попередження зверху', async () => {
    await mount({ ...draft(), committed: true, failed: ['лосось'] } as ChatCard);
    expect(host!.querySelector('[data-cart-failed]')?.textContent).toContain('лосось');
    expect(host!.querySelectorAll('[data-row-failed]').length).toBe(1);
    expect(host!.textContent).toContain('Лосось — не поїхало');
  });
});
