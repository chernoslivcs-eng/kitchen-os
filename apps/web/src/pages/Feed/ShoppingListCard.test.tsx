// @vitest-environment jsdom
// M13-C1 (бета-тестер, PR): кнопка «Зібрати кошик у Сільпо» в панелі «Список»
// стояла завжди — без підключеної мережі клік ловив сирий тост not_connected.
// Тепер кнопка сама знає retailStatus (ProfileV2/Shopping.tsx — той самий
// union) і підміняється лінком підключення: «Підключити Сільпо →» (none),
// «Увійти в Сільпо знову →» (expired/disconnected), нічого (loading/unavailable).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ShoppingListCard, type RetailStatus } from './cards';
import type { ShoppingItem } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined; let host: HTMLDivElement | undefined;
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); root = undefined; host = undefined; });

const item = (id: string): ShoppingItem => ({
  id, household_id: 'h1', label: 'молоко', reason: null, value: null, unit: null, zone: null,
  checked: false, added_by: null, source: 'user', created_at: '2026-09-27T09:00:00Z',
});

async function mount(retailStatus: RetailStatus | undefined, items: ShoppingItem[] = [item('i1')]) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  const onBuildCart = vi.fn();
  await act(async () => {
    root!.render(
      <ShoppingListCard
        items={items}
        sessionStartedAt={null}
        onToggle={() => {}}
        onRemoveBought={() => {}}
        onAdd={() => {}}
        onBuildCart={onBuildCart}
        buildingCart={false}
        retailStatus={retailStatus}
      />,
    );
  });
  return { onBuildCart };
}

describe('ShoppingListCard · кнопка кошика проти лінка підключення', () => {
  it('active: кнопка «Зібрати кошик у Сільпо →», клік кличе onBuildCart, лінка підключення нема', async () => {
    const { onBuildCart } = await mount('active');
    expect(host!.querySelector('[data-connect]')).toBeNull();
    const btn = [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Зібрати кошик у Сільпо →');
    expect(btn).toBeTruthy();
    await act(async () => { btn!.click(); });
    expect(onBuildCart).toHaveBeenCalledTimes(1);
  });

  it('none: лінк «Підключити Сільпо →» на /v1/retail/silpo/connect?next=/app, кнопки кошика нема', async () => {
    await mount('none');
    expect(host!.textContent).not.toContain('Зібрати кошик у Сільпо');
    const a = host!.querySelector<HTMLAnchorElement>('[data-connect]')!;
    expect(a).toBeTruthy();
    expect(a.textContent).toBe('Підключити Сільпо →');
    expect(a.getAttribute('href')).toBe('/v1/retail/silpo/connect?next=%2Fapp');
  });

  it('expired: лінк «Увійти в Сільпо знову →», той самий шлях', async () => {
    await mount('expired');
    const a = host!.querySelector<HTMLAnchorElement>('[data-connect]')!;
    expect(a.textContent).toBe('Увійти в Сільпо знову →');
    expect(a.getAttribute('href')).toBe('/v1/retail/silpo/connect?next=%2Fapp');
  });

  it('disconnected: той самий лінк «Увійти в Сільпо знову →», що expired', async () => {
    await mount('disconnected');
    const a = host!.querySelector<HTMLAnchorElement>('[data-connect]')!;
    expect(a.textContent).toBe('Увійти в Сільпо знову →');
  });

  it('loading/unavailable: ні кнопки, ні лінка — статус ще не відомий чи мережі нема взагалі', async () => {
    await mount('loading');
    expect(host!.querySelector('[data-connect]')).toBeNull();
    expect(host!.textContent).not.toContain('Зібрати кошик у Сільпо');
    await mount('unavailable');
    expect(host!.querySelector('[data-connect]')).toBeNull();
  });

  it('список порожній (toBuy=0): лінк підключення теж не лізе поверх порожнього стану', async () => {
    await mount('none', []);
    expect(host!.querySelector('[data-connect]')).toBeNull();
  });
});
