// @vitest-environment jsdom
//
// FIXES-V3 №6: штрих знака — 1.75 у координатах viewBox, як у бандлі
// (`createIcons({ attrs: { 'stroke-width': 1.75 } })`, Icons.dc.html:217).
// `absoluteStrokeWidth` у lucide-react множив штрих на 24/size — у 12 px
// виходило 3.5, і всі знаки на десктопі стояли «як брудні плями».
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Icon } from './Icon';

const strokeOf = (html: string) => html.match(/stroke-width="([^"]+)"/)?.[1];

describe('№6 · штрих знака масштабується з розміром', () => {
  it('lucide: stroke-width 1.75 у viewBox при 12 і при 24', () => {
    expect(strokeOf(renderToStaticMarkup(<Icon name="sys.close" size={12} />))).toBe('1.75');
    expect(strokeOf(renderToStaticMarkup(<Icon name="sys.close" size={24} />))).toBe('1.75');
  });
  it('власні шляхи (book / fridge) — тим самим правилом', () => {
    expect(strokeOf(renderToStaticMarkup(<Icon name="sys.recipes" size={12} />))).toBe('1.75');
    expect(strokeOf(renderToStaticMarkup(<Icon name="sys.pantry" size={18} />))).toBe('1.75');
  });
});
