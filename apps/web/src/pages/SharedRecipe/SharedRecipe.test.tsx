// @vitest-environment jsdom
// Крок 4 things-v3: публічний рецепт за Screens «Публічний рецепт · 1440»
// (B2): шапка без рейки, кроки номерами, «Склад · N», шавлієва картка з
// однією дією — гостю «Увійти в Кухню», своєму «Готуй у себе».
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SharedRecipePage } from './SharedRecipe';
import { useAuth } from '../../store/auth';

let root: Root | undefined; let host: HTMLDivElement | undefined;
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
const recipe = { t: 'Паста', sv: 2, tm: 25, ch: '', d: 'Опис.', rk: '', nu: { kcal: 540, p: 22, f: 18, c: 68 },
  ing: [{ n: 'Помідори', v: 600, u: 'g' }, { n: 'Сіль, перець' }], st: [{ t: 'Пекти', c: '20 хвилин.' }, { t: 'Зібрати', c: 'Перемішати.' }] };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/v1/r/x1') return json({ id: 'x1', title: recipe.t, recipe, created_at: '', nutrition_calc: null });
    return json({});
  }));
});
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); vi.unstubAllGlobals(); });

async function mount(status: 'signed_in' | 'signed_out') {
  useAuth.setState({ status } as never);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => {
    root!.render(<MemoryRouter initialEntries={['/r/x1']}><Routes><Route path="/r/:id" element={<SharedRecipePage />} /></Routes></MemoryRouter>);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe('SharedRecipePage · крок 4', () => {
  it('гість: шапка «Кухня · спільний рецепт · Увійти», рядок «25 хв · 2 порції · ≈ 540 ккал», склад з «—», кроки, «Увійти в Кухню»', async () => {
    await mount('signed_out');
    const t = host!.textContent ?? '';
    expect(t).toContain('спільний рецепт');
    expect(t).toContain('25 хв');
    expect(t).toContain('2 порції');
    expect(t).toContain('≈ 540 ккал · Б 22 · Ж 18 · В 68');
    expect(t).not.toContain('на порцію');
    expect(t).toContain('Склад · 2');
    expect(host!.querySelector('[data-testid="ingredients"]')!.textContent).toContain('—');
    expect(host!.querySelectorAll('[data-testid="steps"] > *').length).toBe(2);
    expect(host!.querySelector('[data-login]')!.textContent).toBe('Увійти в Кухню');
    expect(host!.querySelector('[data-cook-mine]')).toBeNull();
    expect(t).not.toMatch(/ІНГРЕДІЄНТИ|КРОКИ|СПІЛЬНИЙ РЕЦЕПТ/);
  });
  it('свій: «Готуй у себе», без «Увійти»', async () => {
    await mount('signed_in');
    expect(host!.querySelector('[data-cook-mine]')!.textContent).toBe('Готуй у себе');
    expect(host!.querySelector('[data-login]')).toBeNull();
    expect([...host!.querySelectorAll('button')].some((b) => b.textContent === 'Увійти')).toBe(false);
  });
});
