// @vitest-environment jsdom
//
// Крок О2 (3): вихід у «Поділитись» із покрокового готування.
//
// Кнопка не має бути обхідним шляхом повз журнал: вона робить рівно ту саму
// роботу, що «Приготували», і лише потім веде на /share. Найдорожче тут —
// мовчазний провал: запис не пройшов, а людина вже на екрані «поділитись» і
// думає, що готування записалось. Тому головний тест — саме про провал.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { CookOverlay } from './Cook';
import { useCookStore } from '../../store/cook';
import { useIncidentStore } from '../../store/incident';
import { loadUnsavedRun } from '../../lib/cook-session';
import type { Recipe } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECIPE: Recipe = {
  t: 'Паста з томатами', sv: 2, tm: 25, ch: 'проста', d: 'Швидка вечеря', rk: 'не переварити',
  ing: [{ n: 'паста', v: 200, u: 'г' }],
  st: [
    { t: 'Вода', c: 'Закипʼятити.' },
    { t: 'Соус', c: 'Обсмажити томати.' },
    { t: 'Зʼєднати', c: 'Змішати й подати.' },
  ],
} as Recipe;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let saveFails = false;
let saved = 0;

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

/**
 * Той самий CookHost, що в каркасі застосунку: коли стор порожніє, оверлей
 * ЗНИМАЄТЬСЯ, а не рендериться з порожнім рецептом. Без цього finish() валить
 * рендер («Rendered fewer hooks than expected») — у продукті цього не буває,
 * бо там теж стоїть господар.
 */
function Host() {
  const args = useCookStore((s) => s.args);
  if (!args) return null;
  return <CookOverlay />;
}

/** Показує, куди застосунок пішов, — без моків роутера. */
function Probe() {
  const loc = useLocation();
  return <i data-where={loc.pathname} data-has-recipe={loc.state ? String(!!(loc.state as { recipe?: unknown }).recipe) : 'none'} />;
}

function installFetch() {
  saveFails = false; saved = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/v1/session/today') return json({ session: { id: 's1', created_at: '2026-09-06T06:00:00Z' }, messages: [] });
    if (url.startsWith('/v1/cook-runs')) {
      if (saveFails) return json({ error: 'boom' }, 500);
      saved += 1;
      return json({ ok: true });
    }
    return json({});
  }));
}

/**
 * DA2-03: після переходу крок замкнений на 400 мс (щоб мокрий палець не
 * перескакував через крок). Тому між натисканнями треба справді почекати —
 * інакше друга кнопка просто вимкнена.
 */
const unlock = () => act(async () => { await new Promise((r) => setTimeout(r, 450)); });

async function mountAtLastStep() {
  useCookStore.getState().open({ recipe: RECIPE });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter initialEntries={['/x']}><Host /><Probe /></MemoryRouter>); });
  // Доходимо до останнього кроку тими самими кнопками, що й людина.
  for (let i = 0; i < RECIPE.st.length - 1; i++) {
    // cook-share-v3: «Крок готово» — атрибутом, не текстом (текст — як у кадрі).
    const go = host!.querySelector<HTMLButtonElement>('[data-step-done]:not(:disabled)');
    await act(async () => { go!.click(); });
    await unlock();
  }
}

const shareBtns = () => [...host!.querySelectorAll<HTMLButtonElement>('[data-share-result]')];
const where = () => host!.querySelector('i')!.getAttribute('data-where');

beforeEach(() => {
  // Cook пише сесію готування в localStorage і відновлює її на монтуванні —
  // без очистки другий тест стартував би одразу на останньому кроці попереднього.
  localStorage.clear();
  installFetch();
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove(); root = undefined; host = undefined;
  useCookStore.getState().close();
  vi.unstubAllGlobals();
});

describe('О2 (3): «Поділитись результатом»', () => {
  it('зʼявляється тільки на останньому кроці', async () => {
    useCookStore.getState().open({ recipe: RECIPE });
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<MemoryRouter initialEntries={['/x']}><Host /><Probe /></MemoryRouter>); });
    expect(shareBtns()).toHaveLength(0);
    const go = host!.querySelector<HTMLButtonElement>('[data-step-done]:not(:disabled)');
    await act(async () => { go!.click(); });
    await unlock();
    expect(shareBtns()).toHaveLength(0);        // ще другий крок із трьох
    const go2 = host!.querySelector<HTMLButtonElement>('[data-step-done]:not(:disabled)');
    await act(async () => { go2!.click(); });
    await unlock();
    expect(shareBtns().length).toBeGreaterThan(0);
  });

  it('спершу записує готування, і лише потім веде на /share з рецептом', async () => {
    await mountAtLastStep();
    await act(async () => { shareBtns()[0]!.click(); });
    // Журнал і списання — та сама робота, що робить «Приготували».
    expect(saved).toBe(1);
    expect(where()).toBe('/share');
    expect(host!.querySelector('i')!.getAttribute('data-has-recipe')).toBe('true');
  });

  it('запис не пройшов — на /share НЕ йдемо, поводимось як звичайний провал', async () => {
    // Ділитись нема чим: готування не записалось і продукти не спишуться.
    // Людину при цьому в пастці не тримаємо — ведемо в стрічку, як завжди.
    await mountAtLastStep();
    saveFails = true;
    await act(async () => { shareBtns()[0]!.click(); });
    expect(where()).toBe('/app');
    // Етап 5 (п.6): але не мовчимо — те саме тіло запиту лежить у сховку і в
    // сторі, звідки смуга «не записалось» шле його ще раз.
    const stash = loadUnsavedRun();
    expect(stash?.recipe.t).toBe(RECIPE.t);
    expect(stash?.opts).toEqual({ skip_pantry: true, recipe_id: undefined, session_id: 's1', ask_writeoff: true });
    expect(useIncidentStore.getState().unsavedCook?.recipe.t).toBe(RECIPE.t);
  });

  it('«Приготував» лишається головною і веде в стрічку', async () => {
    await mountAtLastStep();
    // Текст кнопки — як у кадрі («✓ Приготував»); дія — та сама finish().
    const finish = host!.querySelector<HTMLButtonElement>('[data-finish]');
    await act(async () => { finish!.click(); });
    expect(saved).toBe(1);
    expect(where()).toBe('/app');
  });
});
