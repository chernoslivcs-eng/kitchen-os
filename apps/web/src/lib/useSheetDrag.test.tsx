// @vitest-environment jsdom
//
// FIXES-V3-2 №35: змах униз по граберу/шапці закриває шторку (поріг 80 px або
// швидкість), не дотягнув — повертається; скрол усередині не перехоплюється
// (обробники лише на граберi/шапці). Один механізм на всі шторки.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Sheet } from '../components/Sheet/Sheet';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined; let host: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); root = undefined; vi.useRealTimers(); });

const pe = (type: string, y: number) => new PointerEvent(type, { bubbles: true, clientY: y, pointerId: 1, pointerType: 'touch', button: 0 });
async function mount(onClose: () => void) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<Sheet onClose={onClose} ariaLabel="s"><div data-body style={{ height: 800 }}>вміст</div></Sheet>); });
}

describe('№35 · змах униз закриває шторку', () => {
  it('грабер: 100 px униз → onClose (після виходу 250 мс); 40 px — повертається', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    await mount(onClose);
    const grab = host!.querySelector<HTMLElement>('[data-sheet-grab]')!;
    const panel = host!.querySelector<HTMLElement>('[data-sheet]')!;
    await act(async () => { grab.dispatchEvent(pe('pointerdown', 100)); grab.dispatchEvent(pe('pointermove', 140)); });
    expect(panel.style.transform).toBe('translateY(40px)');
    expect(panel.style.animation, 'анімація входу знята першим дотиком').toBe('none');
    expect(panel.style.transition).toBe('none');
    expect(panel.style.willChange).toBe('transform');
    // Повільний жест: 40 px за 300 мс — нижче і порога ходу, і порога швидкості.
    await act(async () => { vi.advanceTimersByTime(300); });
    await act(async () => { grab.dispatchEvent(pe('pointerup', 140)); });
    expect(panel.style.transform, 'не дотягнув — їде назад за --dur-fast').toBe('translateY(0px)');
    expect(panel.style.transition).toContain('--dur-fast');
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(panel.style.transform, 'після пружини inline знято').toBe('');
    expect(panel.style.willChange).toBe('');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { grab.dispatchEvent(pe('pointerdown', 100)); grab.dispatchEvent(pe('pointermove', 200)); grab.dispatchEvent(pe('pointerup', 200)); });
    expect(panel.style.transform, 'за порогом — виїжджає з поточної точки, не з 0').toBe('translateY(110%)');
    expect(panel.className, 'свій sheet-out не грає').not.toContain('panel-out');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('дотик під час анімації входу знімає її одразу, зсув — лише translateY', async () => {
    const onClose = vi.fn();
    await mount(onClose);
    const grab = host!.querySelector<HTMLElement>('[data-sheet-grab]')!;
    const panel = host!.querySelector<HTMLElement>('[data-sheet]')!;
    expect(panel.style.animation).toBe('');
    await act(async () => { grab.dispatchEvent(pe('pointerdown', 100)); });
    expect(panel.style.animation).toBe('none');
    expect(panel.style.transform).toBe('translateY(0px)');
    expect(panel.style.willChange).toBe('transform');
    expect(panel.style.transition).toBe('none');
    await act(async () => { grab.dispatchEvent(pe('pointercancel', 100)); });
    expect(panel.style.transform).toBe('');
  });

  it('шапка теж закриває; вміст — ні (скрол не перехоплюється)', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    await mount(onClose);
    const body = host!.querySelector<HTMLElement>('[data-body]')!;
    await act(async () => { body.dispatchEvent(pe('pointerdown', 100)); body.dispatchEvent(pe('pointermove', 300)); body.dispatchEvent(pe('pointerup', 300)); });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(onClose).not.toHaveBeenCalled();
    const head = host!.querySelector<HTMLElement>('[data-sheet-head]')!;
    await act(async () => { head.dispatchEvent(pe('pointerdown', 100)); head.dispatchEvent(pe('pointermove', 200)); head.dispatchEvent(pe('pointerup', 200)); });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
