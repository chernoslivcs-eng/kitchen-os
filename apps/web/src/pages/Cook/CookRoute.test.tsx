// @vitest-environment jsdom
//
// FIXES-V3 №10 (рішення власника): маршрут Cook Mode відкритий на будь-який
// крок; «Крок готово» відмічає крок, на якому стоїш; таймер кроку, з якого
// пішли, іде далі й показується в маршруті.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { CookOverlay } from './Cook';
import { useCookStore } from '../../store/cook';
import type { Recipe } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECIPE: Recipe = {
  t: 'Паста з томатами', sv: 2, tm: 25, ch: 'проста', d: 'Швидка вечеря', rk: 'не переварити',
  ing: [{ n: 'паста', v: 200, u: 'г' }],
  st: [
    { t: 'Вода', c: 'Закипʼятити.', s: 300 },
    { t: 'Соус', c: 'Обсмажити томати.', s: 600 },
    { t: 'Зʼєднати', c: 'Змішати й подати.' },
  ],
} as Recipe;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

function Host() { const args = useCookStore((s) => s.args); return args ? <CookOverlay /> : null; }
async function mount() {
  useCookStore.getState().open({ recipe: RECIPE });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter initialEntries={['/x']}><Host /></MemoryRouter>); });
}
const click = (sel: string) => act(async () => { host!.querySelector<HTMLButtonElement>(sel)!.click(); });
const current = () => Number(host!.querySelector('[data-route][data-route] [aria-current="step"]')!.getAttribute('data-route-step'));
const unlock = () => act(async () => { await new Promise((r) => setTimeout(r, 450)); });

beforeEach(() => { localStorage.clear(); vi.stubGlobal('fetch', vi.fn(async () => json({ batches: [], products: [] }))); });
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); root = undefined; useCookStore.getState().close(); vi.unstubAllGlobals(); });

describe('№10 · маршрут відкритий', () => {
  it('тап по наступному кроку веде на нього; жоден рядок маршруту не disabled', async () => {
    await mount();
    expect([...host!.querySelectorAll('[data-route] [data-route-step]')].some((b) => (b as HTMLButtonElement).disabled)).toBe(false);
    await click('[data-route] [data-route-step="3"]');
    expect(current()).toBe(3);
    await click('[data-route] [data-route-step="1"]');
    expect(current()).toBe(1);
  });

  it('«Крок готово» відмічає крок, на якому стоїш, і веде на перший невідмічений', async () => {
    await mount();
    await click('[data-route] [data-route-step="2"]');
    await click('[data-step-done]');
    await unlock();
    // відмічено другий, не перший; далі — перший невідмічений після нього (3)
    const doneSteps = [...new Set([...host!.querySelectorAll('[data-route] [data-route-done]')].map((b) => b.getAttribute('data-route-step')))]; // список + чіпи
    expect(doneSteps).toEqual(['2']);
    expect(current()).toBe(3);
  });

  it('таймер кроку, з якого пішли, іде далі; повернення показує залишок, не повний час', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mount();
    await click('[data-timer-toggle]');                     // старт 5:00 на кроці 1
    await act(async () => { vi.advanceTimersByTime(3_000); });
    await click('[data-route] [data-route-step="3"]');      // пішли на крок 3
    await act(async () => { vi.advanceTimersByTime(3_000); });
    // у маршруті крок 1 показує живий залишок, а не «5 хв»
    const row1 = host!.querySelector('[data-route] [data-route-step="1"]')!.textContent!;
    expect(row1).toMatch(/4:5\d/);
    await click('[data-route] [data-route-step="1"]');
    expect(host!.querySelector('[data-timer-value]')!.textContent).toMatch(/4:5\d/);
    vi.useRealTimers();
  });
});
