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
import { closeCookAudioSession } from './cook-sound';
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
  closeCookAudioSession(); // issue #3: сесія спільна — не лишати muted/деталі наступному тесту.
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

// Макет 30.09 (COOK-TIMERS-BRIEF-0930, §2.3): плашка поверх застосунку.
const STEPPED: Recipe = {
  t: 'Спагеттіні з мідіями', sv: 2, tm: 25, ch: '', d: '', rk: '',
  ing: [],
  st: [
    { t: 'Зварити пасту', c: '.', s: 25 },
    { t: 'Тушкувати соус', c: '.', s: 40 },
  ],
} as Recipe;

describe('§2.3 · плашка поверх застосунку', () => {
  const toasts = () => Array.from(host!.querySelectorAll<HTMLElement>('[data-toast]'));

  it('поточний крок добіг поза кукінг-модом — плашка «{рецепт} · {крок} · час вийшов», рецепт приглушений', async () => {
    saveCookSession({ recipe: STEPPED, stepIdx: 0, secondsLeft: 0, deadline: Date.now() - 500 });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    const t = toasts();
    expect(t).toHaveLength(1);
    expect(t[0]!.textContent).toBe('Спагеттіні з мідіями · Зварити пасту · час вийшов');
    expect(t[0]!.getAttribute('data-toast-tone')).toBe('sage');
    const muted = t[0]!.querySelector<HTMLElement>('[class*="muted"]');
    expect(muted?.textContent).toBe('Спагеттіні з мідіями · ');
  });

  it('фоновий таймер поза кукінг-модом — теж плашка', async () => {
    saveCookSession({
      recipe: STEPPED, stepIdx: 0, secondsLeft: 25, deadline: null,
      timers: { 1: { deadline: Date.now() - 300, left: 0 } },
    });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    const t = toasts();
    expect(t).toHaveLength(1);
    expect(t[0]!.textContent).toBe('Спагеттіні з мідіями · Тушкувати соус · час вийшов');
  });

  it('хрестик закриває плашку', async () => {
    saveCookSession({ recipe: STEPPED, stepIdx: 0, secondsLeft: 0, deadline: Date.now() - 500 });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(toasts()).toHaveLength(1);
    await act(async () => { host!.querySelector<HTMLButtonElement>('[data-toast-close]')!.click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(toasts()).toHaveLength(0);
  });

  it('зникає сама за 4с', async () => {
    saveCookSession({ recipe: STEPPED, stepIdx: 0, secondsLeft: 0, deadline: Date.now() - 500 });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(toasts()).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_500); });
    expect(toasts()).toHaveLength(0);
  });

  it('тап відкриває кукінг-мод на тому кроці', async () => {
    saveCookSession({
      recipe: STEPPED, stepIdx: 0, secondsLeft: 25, deadline: null,
      timers: { 1: { deadline: Date.now() - 300, left: 0 } },
    });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(toasts()).toHaveLength(1);
    await act(async () => { toasts()[0]!.click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); }); // фейд тапу
    const args = useCookStore.getState().args;
    expect(args?.recipe.t).toBe('Спагеттіні з мідіями');
    expect(args?.startAt).toBe(1); // фоновий крок 2 (index 1) — саме той, що добіг
  });

  it('два добігли одночасно — дві плашки стосом', async () => {
    saveCookSession({
      recipe: STEPPED, stepIdx: 0, secondsLeft: 0, deadline: Date.now() - 500,
      timers: { 1: { deadline: Date.now() - 300, left: 0 } },
    });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(toasts()).toHaveLength(2);
  });
});
