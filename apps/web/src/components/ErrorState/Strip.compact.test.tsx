// @vitest-environment jsdom
//
// В6 (Р121): на ≤767 смуга — один рядок (знак · кікер · дія), заголовок і тіло
// розгортаються тапом по рядку і згортаються повторним; дія не перемикає
// розгортання. На десктопі (matchMedia не збігається) — форма як була.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Strip } from './Strip';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined; let host: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); root = undefined; vi.unstubAllGlobals(); });

function media(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}
async function mount(cta?: () => void) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<Strip tone="plum" icon="sys.login" kicker="вхід · час оновитись" h1a="Текст на місці." h1b="Вхід — уже ні." body="Зайди ще раз." cta={cta ? 'Повернутись' : undefined} onCta={cta} />); });
  return host;
}

describe('В6 · компактна смуга на ≤767', () => {
  it('рядок згорнутий: кікер — кнопка з aria-expanded, повний текст схований; тап розгортає і згортає', async () => {
    media(true);
    const h = await mount();
    const strip = h.querySelector<HTMLElement>('[data-strip]')!;
    expect(strip.hasAttribute('data-strip-compact')).toBe(true);
    expect(strip.hasAttribute('data-expanded')).toBe(false);
    const toggle = h.querySelector<HTMLButtonElement>('[data-strip-toggle]')!;
    expect(toggle.textContent).toBe('вхід · час оновитись');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await act(async () => { toggle.click(); });
    expect(strip.hasAttribute('data-expanded')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await act(async () => { strip.click(); });
    expect(strip.hasAttribute('data-expanded')).toBe(false);
  });
  it('дія праворуч працює і не розгортає рядок', async () => {
    media(true);
    const onCta = vi.fn();
    const h = await mount(onCta);
    const btn = [...h.querySelectorAll('button')].find((b) => b.textContent === 'Повернутись')!;
    await act(async () => { btn.click(); });
    expect(onCta).toHaveBeenCalledTimes(1);
    expect(h.querySelector('[data-strip]')!.hasAttribute('data-expanded')).toBe(false);
  });
  it('на десктопі форма як була: без кнопки-кікера й без compact', async () => {
    media(false);
    const h = await mount();
    expect(h.querySelector('[data-strip-toggle]')).toBeNull();
    expect(h.querySelector('[data-strip]')!.hasAttribute('data-strip-compact')).toBe(false);
  });
});
