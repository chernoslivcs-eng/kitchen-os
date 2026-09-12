// @vitest-environment jsdom
// Крок 4 things-v3: журнал за Screens «Журнал · 1440» — шапка Рецептів із
// сегментом, картка «За тиждень», групи днів, рядок готування, скасоване.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { CookLogPage, dayLabel, runMinutes } from './CookLog';

let root: Root | undefined; let host: HTMLDivElement | undefined;
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
const today = new Date(); today.setHours(19, 42, 0, 0);
const run = (id: string, title: string, minutesAgo: number, over: Record<string, unknown> = {}) => ({
  id, household_id: 'h', user_id: 'u', recipe_id: `r-${id}`, servings: 2,
  started_at: new Date(today.getTime() - (minutesAgo + 27) * 60_000).toISOString(),
  finished_at: new Date(today.getTime() - minutesAgo * 60_000).toISOString(),
  rating: 4, verdict: null, photo_url: null, changes: { batches: [{ id: 'b1', op: 'deplete' }, { id: 'b2', op: 'deplete' }, { id: 'b3', op: 'deplete' }] }, undone_at: null,
  recipe: { id: `r-${id}`, title, time_total: 25, payload: {}, created_at: '' }, ...over,
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/v1/cook-runs') return json({ runs: [
      run('a', 'Паста з печеними помідорами', 0, { verdict: 'помідори треба було пекти довше' }),
      run('b', 'Рис із креветками', 24 * 60, { undone_at: '2026-09-10T20:30:00Z', rating: null, changes: null }),
    ] });
    if (url === '/v1/recipes') return json({ recipes: [{ id: 'x' }, { id: 'y' }] });
    return json({});
  }));
});
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); vi.unstubAllGlobals(); });

async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter><CookLogPage /></MemoryRouter>); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe('CookLogPage · крок 4', () => {
  it('dayLabel і runMinutes', () => {
    const now = new Date('2026-09-11T12:00:00');
    expect(dayLabel('2026-09-11T08:00:00', now)).toBe('Сьогодні');
    expect(dayLabel('2026-09-10T08:00:00', now)).toBe('Вчора');
    expect(dayLabel('2026-09-07T08:00:00', now)).toBe('Пн · 7 вер');
    expect(runMinutes({ started_at: '2026-09-11T19:15:00Z', finished_at: '2026-09-11T19:42:00Z', recipe: { time_total: 25 } })).toBe(27);
    expect(runMinutes({ started_at: '2026-09-11T19:15:00Z', finished_at: null, recipe: { time_total: 25 } })).toBe(25);
  });

  it('шапка «Рецепти» з сегментом (Журнал активний, «Збережені · 2»), «За тиждень», рядки з «Знову», скасоване без «Знову»', async () => {
    await mount();
    const t = host!.textContent ?? '';
    expect(host!.querySelector('h1')!.textContent).toBe('Рецепти');
    expect(host!.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('Журнал');
    expect(t).toContain('Збережені· 2');
    expect(host!.querySelector('[data-testid="week"]')!.textContent).toBe('За тиждень — 1 готування. Середня оцінка 4,0 · 3 позиції із того, що було вдома.');
    expect(t).toContain('Сьогодні');
    expect(t).toContain('19:42');
    expect(t).toContain('27 хв');
    expect(t).toContain('3 з того, що було вдома');
    expect(t).toContain('«помідори треба було пекти довше»');
    expect(host!.querySelector('[data-run="a"] [aria-label="Приготувати знову"]')).not.toBeNull();
    expect(host!.querySelector('[data-run="b"] [aria-label="Приготувати знову"]')).toBeNull();
    expect(host!.querySelector('[data-run="b"]')!.textContent).toContain('скасовано — комора повернена');
    expect(t).not.toMatch(/СЬОГОДНІ|ГОТУВАНЬ|СКАСОВАНО|ЗНОВУ/);
  });
});

// FIXES-V3-2 №43: шапка однакова на обох вкладках — пошук і «Записати свій»
// не зникають у Журналі навіть на порожньому екрані; порожній стан — той
// самий патерн, що в «Збережених» (пунктирна картка, копі без змін).
describe('№43 · порожній Журнал', () => {
  it('шапка з пошуком і «Записати свій», порожній стан карткою', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/v1/cook-runs') return json({ runs: [] });
      if (url === '/v1/recipes') return json({ recipes: [] });
      return json({});
    }));
    await mount();
    expect(host!.querySelector('[data-search] input')!.getAttribute('placeholder')).toBe('Знайти в журналі');
    expect(host!.querySelector('[aria-label="Записати свій"]')).not.toBeNull();
    expect(host!.querySelector('[data-empty]')!.textContent).toContain('Тут ще тихо');
    expect(host!.querySelector('[data-empty] h3')).not.toBeNull();
  });
});
