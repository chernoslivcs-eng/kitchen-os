// @vitest-environment jsdom
// Крок 3 things-v3: вміст чека в панелі за Screens «Чат · збірка» (aside чека)
// і Components «receipt artifact»: групи звичайним регістром, паспорт рядка,
// «у списку» на рядку, підвал «N додамо додому · M уже в списку · K не їжа,
// у список · Ні · Застосувати N», рядок — тогл (Prototype).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { IntakeCard } from './cards';
import type { ChatCard } from '../../api';

let root: Root | undefined; let host: HTMLDivElement | undefined;
const card: ChatCard = {
  type: 'intake_diff',
  source: { kind: 'retail_receipt', provider: 'silpo', shop: 'Сільпо', at: '2026-09-07T18:40:00.000Z', total: 1284,
    nonfood: [{ name: 'Засіб для посуду', quantity: 1, unit: 'шт', price: 89, image: null }],
    unmatched: [{ name: 'ЛТ KORISNI КЕР П-Ч 90г', quantity: 1, unit: 'шт', price: 89, image: null }] },
  ops: [
    { op: 'add', label: 'Фует', value: 160, unit: 'g', zone: 'fridge', brand: 'Сільпо', variant: 'ковбаса с/в' },
    { op: 'add', label: 'Молоко', value: 900, unit: 'ml', zone: 'fridge', brand: 'Галичина', variant: '2,5%' },
    { op: 'add', label: 'Яйця', value: 10, unit: 'pcs', zone: 'fridge' },
  ],
} as unknown as ChatCard;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); vi.unstubAllGlobals(); });

async function mount(over: Partial<Parameters<typeof IntakeCard>[0]> = {}) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  const onApply = vi.fn(); const onDismiss = vi.fn();
  await act(async () => {
    root!.render(<MemoryRouter><IntakeCard card={card} cardId="c1" applied={false} applying={false} dismissed={false} undone={false} undoAvailable={false}
      onApply={onApply} onDismiss={onDismiss} shoppingLabels={new Set(['молоко', 'яйця'])} onNonfoodToList={() => {}} {...over} /></MemoryRouter>);
  });
  return { onApply, onDismiss };
}
const btn = (re: RegExp) => [...host!.querySelectorAll('button')].find((b) => re.test(b.textContent?.trim() ?? ''))!;

describe('чек у панелі · крок 3', () => {
  it('шапка, групи звичайним регістром, паспорт, «у списку», підвал з числами', async () => {
    await mount();
    const t = host!.textContent ?? '';
    expect(t).toContain('Чек Сільпо · 07.09');
    expect(t).toContain('5 рядків · 1 284 ₴');
    expect(t).toContain('У комору · 3');
    expect(t).toContain('зняти всі');
    expect(t).toContain('Сільпо · ковбаса с/в');
    expect(host!.querySelectorAll('[data-in-list]').length).toBe(2);
    expect(t).toContain('Не для комори · 1');
    expect(t).toContain('у список побуту');
    expect(t).toContain('Не впевнений · 1');
    expect(t).toContain('«ЛТ KORISNI КЕР П-Ч 90г»');
    expect(t).toContain('3 додамо додому · 2 уже в списку · 1 не їжа, у список');
    expect(btn(/^Застосувати 3$/)).toBeTruthy();
    expect(btn(/^Ні$/)).toBeTruthy();
    // капсу немає ніде
    expect(t).not.toMatch(/У КОМОРУ|ЗНЯТИ ВСІ|НЕ ДЛЯ КОМОРИ|НЕ ВПЕВНЕНИЙ|У СПИСКУ/);
  });

  it('тап по рядку знімає галочку — число в кнопці й у підвалі меншає; «зняти всі» → «повернути всі»; застосовується лише обране', async () => {
    const { onApply } = await mount();
    const row = host!.querySelector<HTMLElement>('[role="checkbox"][aria-label="Молоко"]')!.parentElement!;
    await act(async () => { row.click(); });
    expect(host!.querySelector('[role="checkbox"][aria-label="Молоко"]')!.getAttribute('aria-checked')).toBe('false');
    expect(btn(/^Застосувати 2$/)).toBeTruthy();
    expect(host!.textContent).toContain('2 додамо додому · 1 уже в списку');
    await act(async () => { btn(/^Застосувати 2$/).click(); });
    expect(onApply).toHaveBeenCalledWith([0, 2]);
    await act(async () => { btn(/^зняти всі$/).click(); });
    expect(btn(/^повернути всі$/)).toBeTruthy();
    expect(btn(/^Застосувати 0$/).hasAttribute('disabled')).toBe(true);
  });
});
