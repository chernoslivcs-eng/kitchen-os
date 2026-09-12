// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { lockBodyScroll, __resetBodyLock } from './lockBodyScroll';

beforeEach(() => __resetBodyLock());

describe('lockBodyScroll', () => {
  it('ставить і знімає', () => {
    const off = lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');
    off();
    expect(document.body.style.overflow).toBe('');
  });
  it('два локи, зняті не в тому порядку, не лишають hidden', () => {
    const a = lockBodyScroll();
    const b = lockBodyScroll();
    a();
    expect(document.body.style.overflow).toBe('hidden');
    b();
    expect(document.body.style.overflow).toBe('');
  });
  it('повторний виклик знімача не зʼїдає чужий лок', () => {
    const a = lockBodyScroll();
    const b = lockBodyScroll();
    a(); a();
    expect(document.body.style.overflow).toBe('hidden');
    b();
    expect(document.body.style.overflow).toBe('');
  });
  it('повертає те, що було до першого лока', () => {
    document.body.style.overflow = 'auto';
    const off = lockBodyScroll();
    off();
    expect(document.body.style.overflow).toBe('auto');
  });
});
