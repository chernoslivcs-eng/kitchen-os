// @vitest-environment jsdom
// Порційник (борг 14.09): один степер для сторінки рецепта і панелі в чаті.
// Межі 1..12, на межі кнопка disabled, підпис відмінюється.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Portions } from './Portions';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined; let host: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); root = undefined; });

async function mount(value: number, onChange = vi.fn()) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<Portions value={value} onChange={onChange} />); });
  return onChange;
}
const less = () => host!.querySelector<HTMLButtonElement>('button[aria-label="Менше порцій"]')!;
const more = () => host!.querySelector<HTMLButtonElement>('button[aria-label="Більше порцій"]')!;

describe('Portions', () => {
  it('підпис відмінюється: 1 порція · 2 порції · 5 порцій', async () => {
    await mount(1); expect(host!.textContent).toContain('1 порція');
    await mount(2); expect(host!.textContent).toContain('2 порції');
    await mount(5); expect(host!.textContent).toContain('5 порцій');
  });
  it('«−» і «+» дають value∓1; на 1 «−» disabled, на 12 «+» disabled', async () => {
    const on = await mount(2);
    await act(async () => { less().click(); });
    await act(async () => { more().click(); });
    expect(on.mock.calls.map((c) => c[0])).toEqual([1, 3]);
    await mount(1); expect(less().disabled).toBe(true); expect(more().disabled).toBe(false);
    await mount(12); expect(more().disabled).toBe(true); expect(less().disabled).toBe(false);
  });
  it('група має aria-label «Порції»', async () => {
    await mount(3);
    expect(host!.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Порції');
  });
});
