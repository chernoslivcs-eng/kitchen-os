// @vitest-environment jsdom
// E (20.09): лінк із Telegram /recipe/:id?cook=1 — після завантаження рецепта одразу
// кукінг-мод з кроку 1 (той самий useCookStore.open, що кнопка «Готуємо»); параметр
// знімається з URL (replace), щоб F5 не стартував знову.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { RecipePage } from './Recipe';
import { useCookStore } from '../../store/cook';
import type { Recipe } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined; let host: HTMLDivElement | undefined;
const recipe: Recipe = {
  t: 'Паста', sv: 2, tm: 25, ch: '', d: '', rk: '',
  ing: [{ n: 'Спагеті', v: 200, u: 'g' }],
  st: [{ t: 'Варити', c: '10 хв.' }, { t: 'Подати', c: 'Одразу.' }],
};
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
let lastSearch = '';
function Spy() { lastSearch = useLocation().search; return null; }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/v1/recipes/r1') return json({ id: 'r1', saved_at: null, recipe, nutrition_calc: null });
    if (url === '/v1/recipes') return json({ recipes: [] });
    if (url.startsWith('/v1/pantry')) return json({ batches: [], products: [] });
    if (url.startsWith('/v1/profile')) return json({ veto: [] });
    return json({});
  }));
});
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); useCookStore.getState().close(); vi.unstubAllGlobals(); });

async function mount(entry: string) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => {
    root!.render(<MemoryRouter initialEntries={[entry]}><Spy /><Routes><Route path="/recipe/:id" element={<RecipePage />} /></Routes></MemoryRouter>);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe('RecipePage · ?cook=1', () => {
  it('стартує оверлей на кроці 1 і знімає параметр з URL', async () => {
    await mount('/recipe/r1?cook=1');
    const args = useCookStore.getState().args;
    expect(args?.recipe.t).toBe('Паста');
    expect(args?.recipeId).toBe('r1');
    expect(args?.startAt ?? 0).toBe(0);
    expect(lastSearch).toBe('');
  });

  it('без параметра — нічого не стартує', async () => {
    await mount('/recipe/r1');
    expect(useCookStore.getState().args).toBeNull();
  });
});
