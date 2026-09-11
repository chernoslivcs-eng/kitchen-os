// @vitest-environment jsdom
// Крок 4 things-v3: сторінка рецепта за Screens «Рецепт · 1440 / 390» —
// шапка пігулками, чіп стану, склад із крапками роду й порційником, кроки
// з галочкою, «Готуємо».
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RecipePage, kcalLine } from './Recipe';
import type { Recipe } from '../../api';

let root: Root | undefined; let host: HTMLDivElement | undefined;
const recipe: Recipe = {
  t: 'Паста з печеними помідорами', sv: 2, tm: 25, ch: '', d: 'Помідори печуться повільно.', rk: '',
  nu: { kcal: 540, p: 22, f: 18, c: 68 },
  ing: [{ n: 'Помідори', v: 600, u: 'g', p: 'b1' }, { n: 'Спагеті', v: 200, u: 'g', p: 'b2' }, { n: 'Часник', v: 4, u: 'pcs' }],
  st: [{ t: 'Розігріти', c: 'Духовку на 200°.' }, { t: 'Пекти', c: '20 хвилин.', s: 1200 }],
};
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/v1/recipes/r1') return json({ id: 'r1', saved_at: '2026-09-01T00:00:00Z', recipe, nutrition_calc: null });
    if (url === '/v1/recipes') return json({ recipes: [{ id: 'r1', title: recipe.t, status: 'near', have: 2, total: 3, missing: ['часник'], rescues: ['помідори · 3 дні'], cooked_count: 2, payload: recipe }] });
    if (url.startsWith('/v1/pantry')) return json({ batches: [{ id: 'b1', label: 'Помідори', state: 'sealed' }, { id: 'b2', label: 'Спагеті', state: 'opened' }], products: [] });
    if (url.startsWith('/v1/profile')) return json({ veto: [] });
    return json({});
  }));
});
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); vi.unstubAllGlobals(); });

async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => {
    root!.render(<MemoryRouter initialEntries={['/recipe/r1']}><Routes><Route path="/recipe/:id" element={<RecipePage />} /></Routes></MemoryRouter>);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe('RecipePage · крок 4', () => {
  it('kcalLine: каталог — без «≈» коли точно; оцінка моделі — з «≈»', () => {
    expect(kcalLine({ per_serving: { kcal: 540, protein: 22, fat: 18, carbs: 68 }, approx: false } as never, undefined)).toBe('540 ккал · Б 22 · Ж 18 · В 68 · на порцію');
    expect(kcalLine(null, { kcal: 540, p: 22, f: 18, c: 68 })).toBe('≈ 540 ккал · Б 22 · Ж 18 · В 68 · на порцію');
  });

  it('шапка пігулками, чіп стану з бібліотеки «майже · 2 з 3», «використає», склад із крапками й «відкрито», кроки, «Готуємо»', async () => {
    await mount();
    const t = host!.textContent ?? '';
    expect(host!.querySelector('[data-save]')!.textContent).toBe('Збережено');
    expect(host!.querySelector('[data-share]')).not.toBeNull();
    expect(host!.querySelector('[data-discuss]')).not.toBeNull();
    expect(host!.querySelector('[data-status]')!.getAttribute('data-status')).toBe('amber');
    expect(t).toContain('майже · 2 з 3');
    expect(t).toContain('помідори · 3 дні');
    expect(t).toContain('готував 2 рази');
    expect(t).toContain('≈ 540 ккал · Б 22 · Ж 18 · В 68 · на порцію');
    expect(t).toContain('Склад · 3');
    expect([...host!.querySelectorAll('[data-ing-state]')].map((e) => e.getAttribute('data-ing-state'))).toEqual(['have', 'opened', 'missing']);
    expect(t).toContain('відкрито');
    expect(t).toContain('Кроки · 2');
    expect([...host!.querySelectorAll('[data-step-state]')].map((e) => e.getAttribute('data-step-state'))).toEqual(['current', 'pending']);
    expect(t).toContain('20:00');
    expect(host!.querySelector('[data-cook]')!.textContent).toBe('Готуємо');
    // капсу немає
    expect(t).not.toMatch(/ІНГРЕДІЄНТИ|КРОКИ|РЕЦЕПТ · КРОК/);
  });

  it('галочка на кроці робить його зробленим і рухає поточний; порційник множить кількості', async () => {
    await mount();
    await act(async () => { host!.querySelector<HTMLButtonElement>('[data-step-state="current"] button')!.click(); });
    expect([...host!.querySelectorAll('[data-step-state]')].map((e) => e.getAttribute('data-step-state'))).toEqual(['done', 'current']);
    await act(async () => { host!.querySelector<HTMLButtonElement>('[aria-label="Більше порцій"]')!.click(); });
    expect(host!.textContent).toContain('3 порції');
    expect(host!.textContent).toContain('900 г');
  });
});
