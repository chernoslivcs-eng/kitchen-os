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
import { GlobalCookAlarm } from '../../lib/cook-watch';
import { saveCookSession, clearCookSession } from '../../lib/cook-session';
import { closeCookAudioSession } from '../../lib/cook-sound';
import { useCookStore } from '../../store/cook';
import type { Recipe } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECIPE: Recipe = {
  t: 'Паста', sv: 2, tm: 10, ch: '', d: '', rk: '',
  ing: [],
  st: [
    { t: 'Крок 1', c: 'Перший.', s: 3 },
    { t: 'Крок 2', c: 'Другий.', s: 5 },
    { t: 'Крок 3', c: 'Третій.', s: 3 },
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
  clearCookSession();
  closeCookAudioSession(); // issue #3: сесія спільна — не лишати стан наступному тесту.
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

// Перегляд 30.09 (issue #4): «один раз на таймер, де б він не добіг» — обидва
// напрямки переходу між вартовим і попапом мають лишати сигнал єдиним.
describe('issue #4 — подвійний дзвінок при поверненні', () => {
  it('продзвонив ЗОВНІ (вартовий, поки попап закритий) → відкрив кукінг-мод → тиша', async () => {
    // Дедлайн кроку 1 (s=3) уже минув — так виглядає сесія ПІСЛЯ того, як
    // GlobalCookAlarm її вже відзвонив, поки попап був закритий.
    saveCookSession({ recipe: RECIPE, stepIdx: 0, secondsLeft: 0, deadline: Date.now() - 500 });
    await mount(); // відкрили кукінг-мод на ту саму сесію
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    // Стара логіка («дедлайн минув → 0:00, алярм наздожене ефектом нуля»)
    // продзвонила б тут удруге — алярм тепер живе лише в інтервалі живого
    // відліку (Cook.tsx), куди це пряме setSecondsLeft(0) не заходить.
    expect(vibrate).not.toHaveBeenCalled();
  });

  // Перегляд 30.09, раунд 2 (побічна знахідка): чи сам крок (не пілюля
  // ChatHead) коректно показує «час вийшов» після зовнішнього дзвінка, а не
  // повний/свіжий час. secondsLeft тут СТАЛИЙ (як лишається в сесії, поки
  // таймер біжить, — записується лише на зміну кроку/стану, не щосекунди),
  // deadline — точний: відновлення мусить порахувати залишок ІЗ deadline, а
  // не довіритись сталому secondsLeft.
  it('продзвонив ЗОВНІ → відкрив кукінг-мод → сам крок показує 0:00, не повний час', async () => {
    saveCookSession({ recipe: RECIPE, stepIdx: 0, secondsLeft: 3, deadline: Date.now() - 500 });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(host!.querySelector('[data-timer-value]')!.textContent).toBe('0:00');
    expect(host!.querySelector('[data-timer]')!.className).toMatch(/timer-zero/);
  });

  it('продзвонив ЗОВНІ фоновий крок (timers) → відкрив кукінг-мод → тиша (не лише поточний деdline)', async () => {
    saveCookSession({
      recipe: RECIPE, stepIdx: 1, secondsLeft: 5, deadline: null,
      timers: { 0: { deadline: Date.now() - 400, left: 0 } },
    });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('продзвонив УСЕРЕДИНІ (попап відкритий) → вийшов у чат → ЗОВНІ тиша (закріплення)', async () => {
    await mount();
    await click('[data-timer-toggle]'); // старт кроку 1, s=3
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(vibrate).toHaveBeenCalledTimes(1); // продзвонило всередині

    // «Вийти» — попап закривається, вартовий бере ту саму сесію/аудіосесію.
    await act(async () => { root!.unmount(); });
    host?.remove(); root = undefined;
    useCookStore.getState().close();

    const watchHost = document.createElement('div'); document.body.appendChild(watchHost);
    const watchRoot = createRoot(watchHost);
    await act(async () => { watchRoot.render(<GlobalCookAlarm />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(vibrate).toHaveBeenCalledTimes(1); // і досі один — вартовий не додав другого

    await act(async () => { watchRoot.unmount(); });
    watchHost.remove();
  });

  it('навігація між двома вже-нульовими кроками, потім живий крок — рівно один дзвінок, за живий', async () => {
    // Крок 1 (поточний) і крок 2 (фоновий) уже нульові при відновленні —
    // обидва мовчать (уже перевірено вище). Перехід МІЖ ними не міняє ЧИСЛО
    // secondsLeft (0→0) — рання версія фікса ловила цю мить як «живий нуль»
    // через побічний ефект, що спостерігав secondsLeft; дзвінок тепер живе
    // ЗСЕРЕДИНИ інтервалу відліку (issue #4), куди навігація не заходить
    // узагалі — це і перевіряє цей тест.
    saveCookSession({
      recipe: RECIPE, stepIdx: 0, secondsLeft: 0, deadline: Date.now() - 500,
      timers: { 1: { deadline: null, left: 0 } },
    });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(vibrate).not.toHaveBeenCalled(); // крок 1 — мовчки, уже перевірено

    await click('[data-route][data-route] [data-route-step="2"]'); // крок1(0) → крок2(теж 0)
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(vibrate).not.toHaveBeenCalled(); // і досі мовчки — це не живий нуль

    // Крок 3 — свіжий, живий відлік: перевіряємо, що перехід вище нічого не зачепив.
    await click('[data-route][data-route] [data-route-step="3"]');
    await click('[data-timer-toggle]'); // старт кроку 3, s=3
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(vibrate).toHaveBeenCalledTimes(1); // справжній дзвінок не загубився
  });
});
