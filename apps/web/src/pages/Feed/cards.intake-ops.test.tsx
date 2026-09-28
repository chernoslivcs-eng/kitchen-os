// @vitest-environment jsdom
// Рядки intake-картки поза чеком: знак операції і хвіст «ще N … закінчилось».
//
// Два баги з проду. (1) signFor повертав для correct/rename рядок
// 'live.byHand', і рендер друкував його текстом: «live.byHand Спагеті ›
// 300 г» — задумано було знак «рукою» зі словника. (2) Хвіст знав лише
// дві форми: «ще 2 позицій» замість «ще 2 позиції».
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

async function mount(card: ChatCard, live: Map<string, LivePosition> | null = null) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => {
    root!.render(<MemoryRouter><LivePositions.Provider value={live}>
      <IntakeCard card={card} cardId="c1" applied={false} applying={false} dismissed={false} undone={false} undoAvailable={false}
        onApply={() => {}} onDismiss={() => {}} />
    </LivePositions.Provider></MemoryRouter>);
  });
}
// vitest не обробляє CSS-модулі: клас приходить як `_op-sign_<хеш>`.
const signs = () => [...host!.querySelectorAll<HTMLElement>('[class*="op-sign"]')];
const tail = () => host!.querySelector('[class*="op-gone-tail"]')?.textContent?.trim();

describe('знак операції в рядку intake', () => {
  it('correct і rename — знак «рукою», а не назва знака текстом', async () => {
    await mount({ type: 'intake_diff', ops: [
      { op: 'correct', label: 'Спагеті', value: 300, unit: 'g' },
      { op: 'rename', label: 'Макарони', to: 'Спагеті' },
    ] } as unknown as ChatCard);
    const [correct, rename] = signs();
    for (const s of [correct!, rename!]) {
      expect(s.querySelector('[data-icon="live.byHand"]')).not.toBeNull();
      expect(s.textContent).toBe('');
    }
    expect(host!.textContent).not.toContain('live.byHand');
  });

  it('решта операцій лишається символом', async () => {
    await mount({ type: 'intake_diff', ops: [
      { op: 'add', label: 'Молоко', value: 900, unit: 'ml' },
      { op: 'deplete', label: 'Яйця', value: 2, unit: 'pcs' },
      { op: 'open', label: 'Сир', value: 200, unit: 'g' },
    ] } as unknown as ChatCard);
    expect(signs().map((s) => s.textContent)).toEqual(['+', '−', '◔']);
    expect(host!.querySelector('[class*="op-sign"] [data-icon]')).toBeNull();
  });
});

describe('хвіст «ще N з цього запису вже закінчилось»', () => {
  // Шість додавань з фото полиці; з живої комори зникають перші `gone`.
  const ops = Array.from({ length: 6 }, (_, i) => ({ op: 'add', label: `Позиція ${i + 1}`, value: 1, unit: 'pcs', batch_id: `b${i}` }));
  const liveWithout = (gone: number) => new Map<string, LivePosition>(
    ops.slice(gone).map((o) => [o.batch_id, { label: o.label, value: 1, unit: 'pcs' }]),
  );

  it.each([
    [1, 'ще 1 позиція з цього запису вже закінчилась'],
    [2, 'ще 2 позиції з цього запису вже закінчились'],
    [4, 'ще 4 позиції з цього запису вже закінчились'],
    [5, 'ще 5 позицій з цього запису вже закінчилось'],
  ])('%i закінчилось → «%s»', async (gone, text) => {
    await mount({ type: 'intake_diff', ops } as unknown as ChatCard, liveWithout(gone));
    expect(tail()).toBe(text);
  });
});
