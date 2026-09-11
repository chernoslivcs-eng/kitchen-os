// @vitest-environment jsdom
//
// FIXES-V3 №11: один тост на всі екрани — час тримає сам компонент
// (4 с без дії, 8 с з дією), змах угору закриває. Без onDismiss — стоїть.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Toast } from './Toast';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined; let host: HTMLDivElement | undefined;
const mount = async (el: React.ReactElement) => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(el); });
};
beforeEach(() => { vi.useFakeTimers(); });
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); root = undefined; vi.useRealTimers(); });

describe('№11 · тост', () => {
  it('без дії зникає через 4 с, з дією — через 8 с', async () => {
    const gone = vi.fn();
    await mount(<Toast text="Не вдалось" onDismiss={gone} />);
    await act(async () => { vi.advanceTimersByTime(3_900); });
    expect(gone).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(gone).toHaveBeenCalledTimes(1);

    const gone2 = vi.fn();
    await act(async () => { root!.render(<Toast text="Списано" action={{ label: 'Скасувати', run: () => {} }} onDismiss={gone2} />); });
    await act(async () => { vi.advanceTimersByTime(7_900); });
    expect(gone2).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(gone2).toHaveBeenCalledTimes(1);
  });

  it('без onDismiss стоїть (невдале завантаження — доки не «Повторити»)', async () => {
    await mount(<Toast text="Комора не завантажилась" action={{ label: 'Повторити', run: () => {} }} />);
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(host!.querySelector('[data-toast]')).not.toBeNull();
  });

  it('змах угору (≥ 40 px) закриває', async () => {
    const gone = vi.fn();
    await mount(<Toast text="Не вдалось" onDismiss={gone} />);
    const el = host!.querySelector<HTMLElement>('[data-toast]')!;
    await act(async () => {
      el.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, bubbles: true }));
      el.dispatchEvent(new PointerEvent('pointermove', { clientY: 50, bubbles: true }));
    });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('на ≤768 стоїть угорі під шапкою; на десктопі — знизу (E3)', () => {
    const css = readFileSync(resolve(fileURLToPath(import.meta.url), '..', 'Toast.module.css'), 'utf8');
    const mobile = css.slice(css.indexOf('@media (max-width: 768px)'));
    expect(mobile).toMatch(/top: calc\(64px \+ env\(safe-area-inset-top/);
    expect(mobile).toMatch(/bottom: auto/);
    expect(css.slice(0, css.indexOf('@media (max-width: 768px)'))).toMatch(/bottom: 100px/);
  });
});
