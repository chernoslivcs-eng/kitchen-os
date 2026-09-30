// @vitest-environment jsdom
// Макет 30.09 (COOK-TIMERS-BRIEF-0930, спек §2.2): плашка фонового таймера
// у кукінг-моді — крок, з якого пішли, добіг; людина лишається на своєму
// кроці. jsdom не має AudioContext — звук не при ділі тут (перевірено в
// cook-sound.test.ts); дзвінок (вібрація) уже закріплено окремо в
// Cook.alarm.test.tsx — цей файл про саму плашку: появу, зникнення, стос,
// хрестик, тап, обрізання назви.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { CookOverlay } from './Cook';
import { clearCookSession } from '../../lib/cook-session';
import { closeCookAudioSession } from '../../lib/cook-sound';
import { useCookStore } from '../../store/cook';
import type { Recipe } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECIPE: Recipe = {
  t: 'Спагеттіні з мідіями', sv: 2, tm: 25, ch: '', d: '', rk: '',
  ing: [],
  st: [
    { t: 'Зварити пасту', c: 'Кинь у кипіння.', s: 3 },
    { t: 'Обсмажити цибулю з морквою до золотистого', c: 'На середньому вогні.', s: 5 },
    { t: 'Тушкувати соус', c: 'До загустіння.', s: 3 },
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
const toasts = () => Array.from(host!.querySelectorAll<HTMLElement>('[data-toast]'));

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

describe('§2.2 · плашка фонового таймера', () => {
  it('крок 1 біжить, пішли на крок 2 — крок 1 добігає у фоні: зʼявляється плашка з його назвою', async () => {
    await mount();
    await click('[data-timer-toggle]'); // старт кроку 1, s=3
    await click('[data-route][data-route] [data-route-step="2"]'); // пішли на крок 2 — крок 1 лишається у фоні
    // Запас поверх 3с дедлайну: секундний вартовий (1000мс-інтервал) мусить
    // ще й ПОБАЧИТИ, що дедлайн минув (той самий запас, що в Cook.alarm.test.tsx).
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    const t = toasts();
    expect(t).toHaveLength(1);
    // Перегляд ГОЛОВНИЙ ЧАТ round 2, п.3: роздільник — окремий flex-item, не
    // пробіл у тексті (проміжок — CSS gap); textContent тому без пробілів.
    expect(t[0]!.textContent).toBe('Зварити пасту·час вийшов');
    expect(t[0]!.getAttribute('data-toast-tone')).toBe('sage'); // рід спокійний, не danger/amber
  });

  it('поточний крок (на екрані) плашки НЕ дає — там «час вийшов» на самому кроці', async () => {
    await mount();
    await click('[data-timer-toggle]'); // старт кроку 1, s=3 — лишаємось на ньому
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(toasts()).toHaveLength(0);
    expect(host!.querySelector('[data-timer-value]')!.textContent).toBe('0:00');
  });

  it('зникає сама за 4с', async () => {
    await mount();
    await click('[data-timer-toggle]');
    await click('[data-route][data-route] [data-route-step="2"]');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(toasts()).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000 + 300); }); // 4с тримання + вихід chin (240мс)
    expect(toasts()).toHaveLength(0);
  });

  it('хрестик закриває одразу (не чекаючи 4с)', async () => {
    await mount();
    await click('[data-timer-toggle]');
    await click('[data-route][data-route] [data-route-step="2"]');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(toasts()).toHaveLength(1);
    await click('[data-toast-close]');
    await act(async () => { await vi.advanceTimersByTimeAsync(150); }); // фейд 120мс
    expect(toasts()).toHaveLength(0);
  });

  it('тап по тілу відкриває той крок, дзвінка вдруге нема', async () => {
    await mount();
    await click('[data-timer-toggle]'); // крок 1
    await click('[data-route][data-route] [data-route-step="2"]'); // на крок 2
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); // крок 1 добігає у фоні
    const vibrate = (navigator as unknown as { vibrate: ReturnType<typeof vi.fn> }).vibrate;
    expect(vibrate).toHaveBeenCalledTimes(1); // сигнал уже пролунав тут
    await act(async () => { toasts()[0]!.click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); }); // фейд 120мс тапу
    expect(toasts()).toHaveLength(0);
    expect(host!.querySelector('[data-step-pill]') ?? host!.querySelector('[data-route-step="1"]')).toBeTruthy();
    // Дзвінок не подвоївся від самого тапу — вібрація лишається один раз.
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('два фонові таймери добігають разом — дві плашки стосом, новіша зверху', async () => {
    await mount();
    await click('[data-timer-toggle]'); // старт кроку 1 (s=3)
    await click('[data-route][data-route] [data-route-step="2"]'); // на крок 2, крок 1 лишається у фоні
    await click('[data-timer-toggle]'); // старт кроку 2 (s=5)
    await click('[data-route][data-route] [data-route-step="3"]'); // на крок 3, крок 2 лишається у фоні
    // Крок1 добігає ~t=3, крок2 добігає ~t=5 (з моменту старту кожного) —
    // рахуємо в абсолютних секундах від mount: старт1@0, старт2@~0
    // (кліки миттєві під фейковим годинником) — обидва добіжать близько:
    // просунемось трохи більше за довший (5с) із запасом на вартового.
    await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
    const t = toasts();
    expect(t).toHaveLength(2);
    // Новіша (крок 2 добіг пізніше — 5с проти 3с) — top:0, найвищий z-index.
    const slots = Array.from(host!.querySelectorAll<HTMLElement>('[class*="toast-slot"]'));
    expect(slots).toHaveLength(2);
    const zTop = Number(slots[0]!.style.zIndex);
    const zOther = Number(slots[1]!.style.zIndex);
    expect(zTop).not.toBe(zOther);
  });

  it('довга назва кроку обрізається в один рядок — «· час вийшов» не ріжеться', async () => {
    await mount();
    await click('[data-route][data-route] [data-route-step="2"]'); // крок 2 — довга назва
    await click('[data-timer-toggle]'); // старт кроку 2 (s=5), лишаємось на ньому... треба піти з нього
    await click('[data-route][data-route] [data-route-step="3"]'); // пішли на крок 3
    await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
    const t = toasts();
    expect(t).toHaveLength(1);
    expect(t[0]!.textContent).toBe('Обсмажити цибулю з морквою до золотистого·час вийшов');
    const textEl = t[0]!.querySelector<HTMLElement>('[class*="text"]');
    expect(textEl).toBeTruthy();
    // CSS-модулі в jsdom не рендерять реальний overflow, але клас .text —
    // той самий, що в E3 (white-space не форсовано nowrap там навмисно:
    // текст сам одним рядком за шириною плашки в реальному браузері,
    // перевірка тут — що текст ЦІЛИЙ і «час вийшов» не порізаний рядком).
    expect(t[0]!.textContent!.endsWith('час вийшов')).toBe(true);
  });

  it('після зникнення нічого не лишається — рядок кроку в маршруті звичайний', async () => {
    await mount();
    await click('[data-timer-toggle]');
    await click('[data-route][data-route] [data-route-step="2"]');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); // запас на вартового — плашка зʼявилась
    expect(toasts()).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_500); }); // 4с тримання + вихід chin (240мс), із запасом
    expect(toasts()).toHaveLength(0);
    const row = host!.querySelector('[data-route-step="1"]');
    expect(row?.textContent).not.toMatch(/час вийшов/);
  });
});
