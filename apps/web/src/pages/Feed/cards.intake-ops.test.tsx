// @vitest-environment jsdom
// Рядки intake-картки поза чеком: знак операції.
//
// Баг з проду: signFor повертав для correct/rename рядок 'live.byHand', і
// рендер друкував його текстом: «live.byHand Спагеті › 300 г» — задумано
// було знак «рукою» зі словника.
//
// Хвіст «ще N … закінчилось» (був тут) власник 28.09 скасував — зʼїдене
// тепер рядок, не число; тести — cards.intake-gone.test.tsx (обидва
// рендери, з чеком і без).
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
