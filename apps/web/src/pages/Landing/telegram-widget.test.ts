// @vitest-environment jsdom
//
// Хотфікс (15.09, прод): мобайл-редирект флоу і збірка URL (замість popup,
// який iOS Safari мовчки блокує, бо window.open стається поза жестом тапу —
// SignInForm.tsx).
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTelegramRedirectUrl, isTouchOrNarrow, consumeTelegramRedirectError } from './telegram-widget';

describe('buildTelegramRedirectUrl', () => {
  it('збирає URL на oauth.telegram.org з bot_id, origin і return_to на /auth/telegram', () => {
    const url = new URL(buildTelegramRedirectUrl('123456789'));
    expect(url.origin + url.pathname).toBe('https://oauth.telegram.org/auth');
    expect(url.searchParams.get('bot_id')).toBe('123456789');
    expect(url.searchParams.get('origin')).toBe(window.location.origin);
    expect(url.searchParams.get('embed')).toBe('1');
    expect(url.searchParams.get('request_access')).toBe('write');
    expect(url.searchParams.get('return_to')).toBe(`${window.location.origin}/auth/telegram`);
  });
});

describe('isTouchOrNarrow', () => {
  it('вузький екран (< 768) — true, навіть без coarse pointer', () => {
    const orig = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    expect(isTouchOrNarrow()).toBe(true);
    Object.defineProperty(window, 'innerWidth', { value: orig, configurable: true });
  });

  it('широкий екран без matchMedia (pointer: coarse) — false (десктоп-гілка без змін)', () => {
    const orig = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    expect(isTouchOrNarrow()).toBe(false);
    Object.defineProperty(window, 'innerWidth', { value: orig, configurable: true });
  });
});

describe('consumeTelegramRedirectError', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('без ?tgError=1 — false, адресу не чіпає', () => {
    window.history.replaceState(null, '', '/?foo=1');
    expect(consumeTelegramRedirectError()).toBe(false);
    expect(window.location.search).toBe('?foo=1');
  });
});
