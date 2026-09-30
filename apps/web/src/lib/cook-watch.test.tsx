// @vitest-environment jsdom
// GlobalCookAlarm — спек 30.09 §2.3 (docs/superpowers/specs/2026-09-30-cook-timers-sound-design.md):
// дзвонить один раз на кожен таймер, що добіг, поки кукінг-мод закритий —
// поточний крок (deadline) І фонові (timers), не лише перший, як раніше.
// Повтору кожні 30с більше нема. Немає жодного існуючого тесту на цей файл
// узагалі (перший тест-покриття для нього).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GlobalCookAlarm } from './cook-watch';
import { saveCookSession, clearCookSession } from './cook-session';
import { useCookStore } from '../store/cook';
import type { Recipe } from '../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECIPE: Recipe = { t: 'Паста з сиром', sv: 2, tm: 20, ch: '', d: '', rk: '', ing: [], st: [] } as Recipe;

let root: Root | undefined; let host: HTMLDivElement | undefined;
let vibrate: ReturnType<typeof vi.fn>;

async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<GlobalCookAlarm />); });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  vibrate = vi.fn();
  vi.stubGlobal('navigator', { ...navigator, vibrate });
  useCookStore.getState().close(); // overlayOpen=false — вартовий активний
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove(); root = undefined;
  clearCookSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('§2.3 — вартовий поза Cook Mode', () => {
  it('дедлайн поточного кроку вже минув — дзвонить один раз, не кожні 30с', async () => {
    saveCookSession({ recipe: RECIPE, stepIdx: 0, secondsLeft: 0, deadline: Date.now() - 1000 });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(vibrate).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    // Старий вартовий (lastRing-гейт на 30с) дзвонив би тут ще 3 рази.
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('фоновий таймер (timers) добіг — дзвонить, навіть коли поточний deadline порожній', async () => {
    saveCookSession({
      recipe: RECIPE, stepIdx: 0, secondsLeft: 5, deadline: null,
      timers: { 1: { deadline: Date.now() - 500, left: 0 } },
    });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('поточний і фоновий добігли одночасно — по одному сигналу на кожен, разом два', async () => {
    saveCookSession({
      recipe: RECIPE, stepIdx: 0, secondsLeft: 0, deadline: Date.now() - 500,
      timers: { 1: { deadline: Date.now() - 300, left: 0 } },
    });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('нова сесія (нова картка) з тим самим дедлайном не дзвонить: overlayOpen перезапускає стеження', async () => {
    saveCookSession({ recipe: RECIPE, stepIdx: 0, secondsLeft: 0, deadline: Date.now() - 1000 });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(vibrate).toHaveBeenCalledTimes(1);
    // Відкрили Cook Mode (вартовий вимикається) і закрили знову — нове
    // стеження, rung скидається; той самий дедлайн (людина не рухала таймер
    // усередині) прозвучить ще раз, бо це вже НОВЕ «зовні».
    act(() => { useCookStore.getState().open({ recipe: RECIPE }); });
    act(() => { useCookStore.getState().close(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('дедлайн ще не настав — тиша', async () => {
    saveCookSession({ recipe: RECIPE, stepIdx: 0, secondsLeft: 30, deadline: Date.now() + 30_000 });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('Cook Mode відкритий — вартовий мовчить (свій алярм усередині)', async () => {
    saveCookSession({ recipe: RECIPE, stepIdx: 0, secondsLeft: 0, deadline: Date.now() - 1000 });
    useCookStore.getState().open({ recipe: RECIPE });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(vibrate).not.toHaveBeenCalled();
  });
});
