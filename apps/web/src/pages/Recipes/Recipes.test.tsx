// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { RecipesPage } from './Recipes';
import type { SavedRecipe } from '../../api';

// D5: лічильник у кожній пігулці фільтра; активна показує те, що під нею;
// слово стану в роді; «бракує» / «використає» рядками під назвою.

const R = (id: string, status: SavedRecipe['status'], o: Partial<SavedRecipe> = {}): SavedRecipe => ({
  id, title: `Страва ${id}`, descr: null, character: null, time_total: 25, base_servings: 2, saved_at: null,
  cooked_count: 0, last_cooked_at: null, payload: { t: `Страва ${id}`, nu: { kcal: 540, p: 22, f: 18, c: 68 } } as unknown as SavedRecipe['payload'],
  status, have: 4, total: 6, missing: [], rescues: [], ...o,
});
const recipes = [
  R('a', 'ready', { cooked_count: 2, rescues: ['помідори'] }),
  R('b', 'ready'),
  R('c', 'near', { missing: ['яйця', 'фета'], cooked_count: 1 }),
  R('d', 'far'),
];

describe('RecipesPage', () => {
  let host: HTMLDivElement | undefined; let root: Root | undefined;
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ recipes }), { status: 200, headers: { 'content-type': 'application/json' } })));
  });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); });
  async function mount() {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<MemoryRouter><RecipesPage /></MemoryRouter>); });
    await act(async () => {});
  }
  const chip = (f: string) => host!.querySelector(`[data-filter="${f}"]`)!;
  const cards = () => [...host!.querySelectorAll('[data-status]')];

  it('лічильники в пігулках — кожен своє; сегмент «Збережені · усі»', async () => {
    await mount();
    expect(['all', 'ready', 'near', 'cooked'].map((f) => chip(f).querySelector('[data-count]')!.textContent)).toEqual(['4', '2', '1', '2']);
    expect(host!.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toContain('4');
  });

  it('активна пігулка показує те, що під нею; слово стану і рядки в роді', async () => {
    await mount();
    expect(cards().length).toBe(4);
    expect(cards()[0]!.textContent).toContain('можу зараз');
    expect(cards()[0]!.textContent).toContain('використає: помідори');
    expect(cards()[0]!.textContent).toContain('2 рази');
    await act(async () => { (chip('near') as HTMLElement).click(); });
    expect(cards().map((c) => c.getAttribute('data-status'))).toEqual(['near']);
    expect(cards()[0]!.textContent).toContain('майже');
    expect(cards()[0]!.textContent).toContain('бракує: яйця, фета');
    await act(async () => { (chip('cooked') as HTMLElement).click(); });
    expect(cards().length).toBe(2);
  });
});
