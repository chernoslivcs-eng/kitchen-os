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

// ── Хотфікс 15.09: non-scaling-stroke лише поки грає анімація ─────────────
// `ve: true` (motion.ts) плющив штрих у спокої — vectorEffect стояв атрибутом
// завжди, тому в 12 px виходило 1.75 px на екрані замість 0.9 (удвічі товще
// за sys.chat/sys.pantry поруч). Тепер атрибута нема ніколи — лише маркер
// data-ve, а саму властивість вмикає CSS під [data-play] (Icon.module.css).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('non-scaling-stroke — лише під час анімації, не в спокої', () => {
  it('у спокої в DOM нема атрибута vector-effect на частинах sys.receipt (маркер data-ve є)', () => {
    const html = renderToStaticMarkup(<Icon name="sys.receipt" size={12} decorative />);
    expect(html).not.toMatch(/vector-effect/i);
    // 4 місця з ve:true у CUSTOM_PATHS['sys.receipt'] (body, l1, l2, l3).
    expect((html.match(/data-ve=""/g) ?? []).length).toBe(4);
  });

  it('Icon.module.css вмикає vector-effect: non-scaling-stroke для [data-ve] лише під [data-play]', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/Icon/Icon.module.css'), 'utf8');
    const rule = css.match(/\[data-play\][^{]*\[data-ve\][^{]*\{[^}]*\}/);
    expect(rule?.[0]).toBeTruthy();
    expect(rule![0]).toContain('vector-effect: non-scaling-stroke');
    // Поза [data-play] властивість ніде більше не встановлюється — інакше
    // штрих знову плющився б завжди, а не лише в русі.
    expect(css.match(/vector-effect:\s*non-scaling-stroke/g)?.length).toBe(1);
  });
});

// ── Icon Motion v2 (Р117): рух запускає носій ─────────────────────────────
import { vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

describe('v2 · data-play на носії', () => {
  let root: Root | null = null; let host: HTMLDivElement;
  afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.useRealTimers(); });

  it('pointerenter і click ставлять data-play на кнопку; повтор — лише після dur + 80; mouseleave не обриває', () => {
    vi.useFakeTimers();
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    act(() => root!.render(<button type="button"><Icon name="sys.chat" size={18} decorative /></button>));
    const btn = host.querySelector('button')!;
    expect(btn.dataset.play).toBeUndefined();
    act(() => { btn.dispatchEvent(new Event('pointerenter')); });
    expect(btn.dataset.play).toBe('bubble');
    act(() => { btn.dispatchEvent(new Event('pointerleave')); vi.advanceTimersByTime(500); });
    expect(btn.dataset.play, 'дограється попри mouseleave').toBe('bubble');
    // Повторний вхід на 500-й мс не перезапускає: data-play знімається за
    // 1050 + 80 = 1130 від ПЕРШОГО запуску, а не від другого.
    act(() => { btn.dispatchEvent(new Event('pointerenter')); vi.advanceTimersByTime(700); });
    expect(btn.dataset.play).toBeUndefined();
  });

  it('після тривалості + 80 мс знімається; click теж запускає; частини знака — з файлу', () => {
    vi.useFakeTimers();
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    act(() => root!.render(<button type="button"><Icon name="sys.done" size={16} decorative /></button>));
    const btn = host.querySelector('button')!;
    act(() => { btn.click(); });
    expect(btn.dataset.play).toBe('tick');
    act(() => { vi.advanceTimersByTime(750 + 80); });
    expect(btn.dataset.play).toBeUndefined();
    expect(host.querySelector('[data-p="tick"][data-draw]')?.getAttribute('pathLength')).toBe('1');
  });

  it('1.5b-знак (close) носію data-play не ставить; без носія — сам знак', () => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    act(() => root!.render(<><button type="button" id="b"><Icon name="sys.close" size={16} decorative /></button><Icon name="sys.search" size={20} decorative /></>));
    const btn = host.querySelector('#b')! as HTMLElement;
    act(() => { btn.dispatchEvent(new Event('pointerenter')); });
    expect(btn.dataset.play).toBeUndefined();
    const icon = host.querySelector<HTMLElement>('[data-icon="sys.search"]')!;
    act(() => { icon.dispatchEvent(new Event('pointerenter')); });
    expect(icon.dataset.play).toBe('orbit');
  });
});
