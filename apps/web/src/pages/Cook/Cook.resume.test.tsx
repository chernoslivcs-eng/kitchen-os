// @vitest-environment jsdom
//
// Перегляд ГОЛОВНИЙ ЧАТ (живий баг власника, стенд після мерджу #237): вийшов
// у чат із таймером, що біжить → таймер добіг → плашка → тап — кукінг-мод
// відкривався на тому кроці з ПОВНИМ часом замість «час вийшов». Корінь:
// відновлення сесії латало стан ЕФЕКТАМИ поверх першого рендеру — у
// StrictMode (dev, як на стенді) ефект зміни кроку повторно спрацьовував
// ПІСЛЯ resume-ефекту й переписував щойно відновлене значення назад повним
// часом. Фікс — buildResumePlan (Cook.tsx): одне синхронне обчислення на
// монтуванні. Кожен тест тут рендериться в <StrictMode> саме тому, що бага
// без нього не відтворити — production (без StrictMode) не подвоює ефекти.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { CookOverlay } from './Cook';
import { saveCookSession, clearCookSession } from '../../lib/cook-session';
import { closeCookAudioSession } from '../../lib/cook-sound';
import { useCookStore } from '../../store/cook';
import type { Recipe } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECIPE: Recipe = {
  t: 'Спагеттіні з мідіями', sv: 2, tm: 25, ch: '', d: '', rk: '',
  ing: [],
  st: [
    { t: 'Крок 1', c: 'Зварити пасту.', s: 180 },
    { t: 'Крок 2', c: 'Обсмажити цибулю.', s: 300 },
    { t: 'Крок 3', c: 'Тушкувати соус.', s: 120 },
  ],
} as Recipe;

let root: Root | undefined; let host: HTMLDivElement | undefined;
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
function Host() { const args = useCookStore((s) => s.args); return args ? <CookOverlay /> : null; }
// StrictMode — навмисно: саме тут бага без нього не побачити (single-pass
// production-порядок ефектів рятує сам собою; подвоєння StrictMode — ні).
async function mount(openArgs: { startAt?: number } = {}) {
  useCookStore.getState().open({ recipe: RECIPE, ...openArgs });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => {
    root!.render(<StrictMode><MemoryRouter initialEntries={['/x']}><Host /></MemoryRouter></StrictMode>);
  });
}
const timerValue = () => host!.querySelector('[data-timer-value]')!.textContent;
const stepText = () => host!.querySelector('[data-step-text]')!.textContent;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => json({ batches: [], products: [] })));
  vi.stubGlobal('navigator', { ...navigator, vibrate: vi.fn() });
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove(); root = undefined;
  useCookStore.getState().close();
  clearCookSession();
  closeCookAudioSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('відновлення сесії в StrictMode (перегляд ГОЛОВНИЙ ЧАТ)', () => {
  it('(а) добіг поточний крок зовні → тап (startAt той самий) → «час вийшов», без дзвінка', async () => {
    const now = Date.now();
    saveCookSession({
      recipe: RECIPE, stepIdx: 1, secondsLeft: 0, deadline: now - 5_000,
      done: [0], timers: {},
    });
    const vibrate = (navigator as unknown as { vibrate: ReturnType<typeof vi.fn> }).vibrate;
    await mount({ startAt: 1 });
    expect(stepText()).toBe('Обсмажити цибулю.');
    expect(timerValue()).toBe('0:00');
    expect(host!.querySelector('[data-timer-toggle]')!.textContent).toContain('Спочатку'); // 0 — не «Пауза», не біжить
    expect(vibrate).not.toHaveBeenCalled(); // GlobalCookAlarm уже подзвонив зовні — тут мовчки
  });

  it('(б) добіг фоновий крок зовні → тап (startAt саме той) → саме той крок, «час вийшов»', async () => {
    const now = Date.now();
    saveCookSession({
      recipe: RECIPE, stepIdx: 0, secondsLeft: 90, deadline: null,
      done: [], timers: { 2: { deadline: now - 2_000, left: 0 } },
    });
    await mount({ startAt: 2 }); // тап по плашці фонового кроку 2
    expect(stepText()).toBe('Тушкувати соус.');
    expect(timerValue()).toBe('0:00');
  });

  it('(в) вийшов і повернувся, поки таймер біжить → залишок правильний, біжить далі', async () => {
    const now = Date.now();
    saveCookSession({
      recipe: RECIPE, stepIdx: 0, secondsLeft: 180, deadline: now + 42_000,
      done: [], timers: {},
    });
    await mount({ startAt: 0 });
    expect(timerValue()).toBe('0:42');
    expect(host!.querySelector('[data-timer-toggle]')!.textContent).toContain('Пауза'); // біжить
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(timerValue()).toBe('0:37'); // і далі рахує, не застряг і не скинувся
  });

  it('(г) те саме через звичайне «Готуємо» (без startAt/плашки) — відновлює saved.stepIdx і залишок', async () => {
    const now = Date.now();
    saveCookSession({
      recipe: RECIPE, stepIdx: 1, secondsLeft: 300, deadline: now + 20_000,
      done: [0], timers: {},
    });
    await mount(); // без startAt — як звичайна кнопка «Готуємо»
    expect(stepText()).toBe('Обсмажити цибулю.'); // saved.stepIdx (1), не 0
    expect(timerValue()).toBe('0:20');
    expect(host!.querySelector('[data-timer-toggle]')!.textContent).toContain('Пауза');
  });

  it('startAt перемагає saved.stepIdx, коли вони різні (тап по плашці не того кроку, де застала сесія)', async () => {
    const now = Date.now();
    saveCookSession({
      recipe: RECIPE, stepIdx: 0, secondsLeft: 60, deadline: now + 10_000, // крок 0 і досі біжить
      done: [], timers: { 2: { deadline: now - 1_000, left: 0 } }, // крок 2 добіг у фоні
    });
    await mount({ startAt: 2 });
    expect(stepText()).toBe('Тушкувати соус.'); // крок ІЗ ПЛАШКИ (2), не saved.stepIdx (0)
    expect(timerValue()).toBe('0:00');
  });
});
