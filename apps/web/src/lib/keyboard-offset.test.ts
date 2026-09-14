// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installKeyboardOffset } from './keyboard-offset';

// 14.09: iOS ховає клавіатуру без blur — бар лишався схованим. Перехід
// «клавіатура відкрита → закрита» при полі у фокусі має зняти фокус.
function fakeViewport(height: number, innerHeight = 800) {
  const listeners: Record<string, (() => void)[]> = {};
  const vv = {
    height,
    addEventListener: (t: string, fn: () => void) => { (listeners[t] ??= []).push(fn); },
  };
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: innerHeight, writable: true, configurable: true });
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { fn(); return 0; });   // синхронно; 0 — щоб schedule не думав, що кадр ще в черзі
  return { vv, resize: () => listeners['resize']?.forEach((f) => f()) };
}

describe('installKeyboardOffset', () => {
  beforeEach(() => { document.body.innerHTML = '<textarea id="c"></textarea>'; });

  it('клавіатура закрилась (iOS) при полі у фокусі → фокус знято, --kb 0', () => {
    const { vv, resize } = fakeViewport(800);
    installKeyboardOffset();
    const ta = document.getElementById('c') as HTMLTextAreaElement;
    ta.focus();
    vv.height = 500; resize();
    expect(document.documentElement.style.getPropertyValue('--kb')).toBe('300px');
    expect(document.activeElement).toBe(ta);
    vv.height = 800; resize();
    expect(document.documentElement.style.getPropertyValue('--kb')).toBe('0px');
    expect(document.activeElement).not.toBe(ta);
  });

  it('Chrome iOS: innerHeight падає разом із visualViewport (kb завжди 0) — стрибок vv угору все одно знімає фокус', () => {
    const { vv, resize } = fakeViewport(800);
    installKeyboardOffset();
    const ta = document.getElementById('c') as HTMLTextAreaElement;
    ta.focus();
    (window as unknown as { innerHeight: number }).innerHeight = 500; vv.height = 500; resize();
    expect(document.documentElement.style.getPropertyValue('--kb')).toBe('0px');
    expect(document.activeElement).toBe(ta);
    (window as unknown as { innerHeight: number }).innerHeight = 800; vv.height = 800; resize();
    expect(document.activeElement).not.toBe(ta);
  });

  it('дрібні зміни висоти (адресний рядок, ±60) фокус не чіпають', () => {
    const { vv, resize } = fakeViewport(800);
    installKeyboardOffset();
    const ta = document.getElementById('c') as HTMLTextAreaElement;
    ta.focus();
    vv.height = 740; resize();
    vv.height = 800; resize();
    expect(document.activeElement).toBe(ta);
  });
});
