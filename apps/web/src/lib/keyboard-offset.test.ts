// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installKeyboardOffset } from './keyboard-offset';

// 14.09: iOS ховає клавіатуру без blur — бар лишався схованим. Перехід
// «клавіатура відкрита → закрита» при полі у фокусі має зняти фокус.
function fakeViewport(height: number) {
  const listeners: Record<string, (() => void)[]> = {};
  const vv = {
    height,
    addEventListener: (t: string, fn: () => void) => { (listeners[t] ??= []).push(fn); },
  };
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
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

  it('без переходу «відкрито → закрито» (Android/десктоп: kb завжди 0) фокус не чіпаємо', () => {
    const { resize } = fakeViewport(800);
    installKeyboardOffset();
    const ta = document.getElementById('c') as HTMLTextAreaElement;
    ta.focus();
    resize(); resize();
    expect(document.activeElement).toBe(ta);
  });
});
