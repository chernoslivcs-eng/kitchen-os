// @vitest-environment jsdom
// Власник 28.09: позиції картки запису, які ПОТІМ закінчились, раніше
// ховались і лишали хвіст «ще N … закінчилось». Тепер — той самий рядок, що
// й додане, зі знаком «−» (signFor('deplete')) на місці «+», приглушений,
// без закреслення; лічильник шапки (там, де він є — чек) рахує лише живі.
// Обидва рендери IntakeCard: без чека (.ops/.op) і з чеком (ReceiptGroup/.rrow).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { IntakeCard, LivePositions, type LivePosition } from './cards';
import type { ChatCard } from '../../api';

let root: Root | undefined; let host: HTMLDivElement | undefined;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); vi.unstubAllGlobals(); });

async function mount(card: ChatCard, live: Map<string, LivePosition> | null) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => {
    root!.render(<MemoryRouter><LivePositions.Provider value={live}>
      <IntakeCard card={card} cardId="c1" applied={true} applying={false} dismissed={false} undone={false} undoAvailable={false} />
    </LivePositions.Provider></MemoryRouter>);
  });
}

// 3 додано, 3-тя (b3, «Йогурт») з живої комори зникла — зʼїли/протухло.
const ops = [
  { op: 'add', label: 'Молоко', value: 1, unit: 'l', batch_id: 'b1' },
  { op: 'add', label: 'Яйця', value: 10, unit: 'pcs', batch_id: 'b2' },
  { op: 'add', label: 'Йогурт', value: 4, unit: 'pcs', batch_id: 'b3' },
];
const liveWithB3Gone = new Map<string, LivePosition>([
  ['b1', { label: 'Молоко', value: 1, unit: 'l' }],
  ['b2', { label: 'Яйця', value: 10, unit: 'pcs' }],
]);

describe('IntakeCard · без чека — зʼїдене рядком, не хвостом', () => {
  it('3 рядки (не 2 + хвіст), третій зі знаком «−» і приглушений, кількість — та, що додавали', async () => {
    await mount({ type: 'intake_diff', ops } as unknown as ChatCard, liveWithB3Gone);
    const labels = [...host!.querySelectorAll<HTMLElement>('[class*="op-label"]')].map((el) => el.textContent);
    expect(labels).toEqual(['Молоко', 'Яйця', 'Йогурт']);
    expect(host!.textContent).not.toContain('закінчилось');
    expect(host!.textContent).not.toContain('закінчились');

    const signs = [...host!.querySelectorAll<HTMLElement>('[class*="op-sign"]')].map((el) => el.textContent);
    expect(signs).toEqual(['+', '+', '−']);

    const goneRow = [...host!.querySelectorAll<HTMLElement>('[class*="op-gone"]')];
    expect(goneRow.length).toBe(1);
    expect(goneRow[0]!.textContent).toContain('Йогурт');
    expect(goneRow[0]!.querySelector('[class*="op-qty"]')?.textContent).toContain('4');
  });
});

describe('IntakeCard · з чеком — зʼїдене рядком у ReceiptGroup, лічильник рахує лише живі', () => {
  it('3 рядки, третій «−» і muted (rrow-quiet), шапка «У комору · 2», хвоста нема', async () => {
    const card = { type: 'intake_diff', ops, source: { kind: 'chat_receipt', at: '2026-09-28T09:00:00Z' } } as unknown as ChatCard;
    await mount(card, liveWithB3Gone);

    const header = host!.querySelector('[class*="rgroup-title"]')?.textContent ?? '';
    expect(header).toContain('У комору');
    expect(header).toContain('2');
    expect(header).not.toContain('3');

    const titles = [...host!.querySelectorAll<HTMLElement>('[class*="rrow-title"]')].map((el) => el.textContent);
    expect(titles).toEqual(['Молоко', 'Яйця', 'Йогурт']);
    expect(host!.textContent).not.toContain('закінчилось');
    expect(host!.textContent).not.toContain('закінчились');

    const signs = [...host!.querySelectorAll<HTMLElement>('[class*="rrow-sign"]')].map((el) => el.textContent);
    expect(signs).toEqual(['−']);

    const quiet = [...host!.querySelectorAll<HTMLElement>('[class*="rrow-quiet"]')];
    expect(quiet.length).toBe(1);
    expect(quiet[0]!.textContent).toContain('Йогурт');
    expect(quiet[0]!.querySelector('[class*="rrow-qty"]')?.textContent).toContain('4');
  });
});
