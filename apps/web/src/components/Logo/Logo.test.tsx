// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Logo } from './Logo';

// 12.09 (ANSWERS E13): кільце помилки й логотип — один знак з параметром розриву.
describe('Logo · один знак, два розриви', () => {
  it('логотип: розрив 45° угорі (те саме «104 15» з поворотом −58°)', () => {
    const html = renderToStaticMarkup(<Logo />);
    expect(html).toContain('stroke-dasharray="104.5 14.9"');
    expect(html).toContain('rotate(-58 24 24)');
    expect(html).toContain('fill="var(--sage)"');
  });
  it('помилка: розрив 90° угорі праворуч, вузол кольору роду', () => {
    const html = renderToStaticMarkup(<Logo size={64} gap={90} gapStart={-90} core="var(--danger)" />);
    expect(html).toContain('stroke-dasharray="89.5 29.8"');
    expect(html).toContain('rotate(0 24 24)');
    expect(html).toContain('fill="var(--danger)"');
    expect(html).toContain('width="64"');
  });
});
