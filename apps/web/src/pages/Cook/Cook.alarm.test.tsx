// @vitest-environment jsdom
// Спек 30.09 §2.1/§2.2 (docs/superpowers/specs/2026-09-30-cook-timers-sound-design.md):
// таймер дзвонить один раз і замовкає — ні повтору кожні 30с (кіт DA2-08,
// скасовано власником 30.09), ні для кроку на екрані, ні для фонового.
// jsdom не має AudioContext — CookAudioSession.ensure() мовчки повертає null
// (перевірено юніт-тестом у cook-sound.test.ts), тож тут звук не при ділі:
// вібрація [200,100,200] — той самий виклик, що йде поруч з алярмом
// (ringAlarm, cook-sound.ts), і рахувати її — надійний спосіб порахувати,
// скільки разів прозвучав сигнал, без мокання Web Audio вдруге.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { CookOverlay } from './Cook';
import { useCookStore } from '../../store/cook';
import type { Recipe } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECIPE: Recipe = {
  t: 'Паста', sv: 2, tm: 10, ch: '', d: '', rk: '',
  ing: [],
  st: [
    { t: 'Крок 1', c: 'Перший.', s: 3 },
    { t: 'Крок 2', c: 'Другий.', s: 5 },
  ],
} as Recipe;

let root: Root | undefined; let host: HTMLDivElement | undefined;
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
function Host() { const args = useCookStore((s) => s.args); return args ? <CookOverlay /> : null; }
async function mount() {
  useCookStore.getState().open({ recipe: RECIPE });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter initialEntries={['/x']}><Host /></MemoryRouter>); });
}
const click = (sel: string) => act(async () => { host!.querySelector<HTMLButtonElement>(sel)!.click(); });

let vibrate: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => json({ batches: [], products: [] })));
  vibrate = vi.fn();
  vi.stubGlobal('navigator', { ...navigator, vibrate });
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove(); root = undefined;
  useCookStore.getState().close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('§2.1 — крок на екрані: аларм один раз, без повтору кожні 30с', () => {
  it('добіг — вібрація один раз; ще 90с тиші — і досі один раз', async () => {
    await mount();
    await click('[data-timer-toggle]'); // старт 3-секундного таймера кроку 1
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(vibrate).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    // Старий код (setInterval(beep, 30_000)) дав би тут ще 3 виклики (30/60/90с).
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});

describe('§2.2 — фоновий таймер (крок, з якого пішли): аларм теж один раз', () => {
  it('пішли з кроку 1 (біжить), його таймер добігає у фоні — один сигнал', async () => {
    await mount();
    await click('[data-timer-toggle]'); // старт кроку 1, s=3
    await click('[data-route][data-route] [data-route-step="2"]'); // пішли на крок 2 — крок 1 лишається у фоні
    // Запас поверх 3с дедлайну: секундний вартовий (1000мс-інтервал) мусить
    // ще й ПОБАЧИТИ, що дедлайн минув, — на повільному CI/паралельних воркерах
    // жорсткі 3200мс іноді не лишають йому шансу спрацювати.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(vibrate).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});
