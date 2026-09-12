// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useFlipRows } from './useFlipRows';

function Rows({ ids }: { ids: string[] }) {
  useFlipRows(ids, (id) => `row-${id}`);
  return <div>{ids.map((id) => <div key={id} id={`row-${id}`} data-top={id}>{id}</div>)}</div>;
}

const tops: Record<string, number> = { a: 0, b: 48, c: 96 };

describe('useFlipRows (B7): рядок їде на нове місце', () => {
  let root: Root | null = null;
  let host: HTMLDivElement;
  afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.restoreAllMocks(); });

  it('після перестановки викликає animate з translateY на різницю позицій', () => {
    host = document.createElement('div'); document.body.appendChild(host);
    const animate = vi.fn();
    // jsdom не міряє розкладку: верх рядка — за його місцем у списку.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const idx = [...this.parentElement!.children].indexOf(this);
      return { top: idx * 48, left: 0, width: 0, height: 48, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
    });
    HTMLElement.prototype.animate = animate;
    document.documentElement.style.setProperty('--dur-base', '240ms');

    root = createRoot(host);
    act(() => root!.render(<Rows ids={['a', 'b', 'c']} />));
    expect(animate).not.toHaveBeenCalled();   // перший кадр — нема з чим порівнювати
    act(() => root!.render(<Rows ids={['c', 'a', 'b']} />));
    // c піднявся з 96 на 0 → їде з +96 до нуля; a і b опустились на 48.
    const calls = animate.mock.calls.map((c) => (c[0] as { transform: string }[])[0]!.transform);
    expect(calls).toContain('translateY(96px)');
    expect(calls).toContain('translateY(-48px)');
    expect(animate.mock.calls[0]![1]).toMatchObject({ duration: 240 });
    void tops;
  });
});
