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

// Макет 30.09 (COOK-TIMERS-BRIEF-0930): плашка фонового таймера — той самий
// тост, з доданими closable/onTap/placement="chin".
describe('макет 30.09 · closable/onTap/chin', () => {
  // Виміряно в бандлі (Kitchen OS - Cook Timers.dc.html): назва кроку — 600,
  // назва рецепта (mutedPrefix) і «· час вийшов» (text) — 400.
  it('lead — жирний, mutedPrefix і text — звичайні; порядок mutedPrefix → lead → text', async () => {
    await mount(<Toast text=" · час вийшов" lead="Зварити пасту" mutedPrefix="Спагеттіні з мідіями" tone="sage" />);
    const textEl = host!.querySelector<HTMLElement>('[class*="text"]')!;
    expect(textEl.textContent).toBe('Спагеттіні з мідіями · Зварити пасту · час вийшов');
    const lead = textEl.querySelector('b')!;
    expect(lead.textContent).toBe('Зварити пасту');
    const muted = textEl.querySelector<HTMLElement>('[class*="muted"]')!;
    expect(muted.textContent).toBe('Спагеттіні з мідіями · ');
  });

  it('chin: «· час вийшов» (trail) ніколи не обрізається — трикрапка лише на lead (CSS)', () => {
    const css = readFileSync(resolve(fileURLToPath(import.meta.url), '..', 'Toast.module.css'), 'utf8');
    const chinBlock = css.slice(css.indexOf('.toast.chin .text'), css.indexOf('.toast.chin .text') + 400);
    expect(chinBlock).toMatch(/\.toast\.chin \.lead\s*\{[^}]*text-overflow:\s*ellipsis/s);
    expect(chinBlock).toMatch(/\.toast\.chin \.trail\s*\{[^}]*flex:\s*none/s);
    expect(chinBlock).not.toMatch(/\.trail\s*\{[^}]*text-overflow/s); // .trail сам не обрізається
  });

  it('closable: клік по хрестику закриває, дію не чіпаючи', async () => {
    const gone = vi.fn();
    const run = vi.fn();
    await mount(<Toast text="Зварити пасту · час вийшов" onDismiss={gone} closable action={{ label: 'Дія', run }} />);
    const close = host!.querySelector<HTMLButtonElement>('[data-toast-close]')!;
    await act(async () => { close.click(); });
    expect(run).not.toHaveBeenCalled(); // хрестик — не дія
    await act(async () => { vi.advanceTimersByTime(130); }); // хрестик — 120 мс, не 160
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('onTap: клік по тілу викликає onTap і закриває; клік по хрестику onTap НЕ викликає', async () => {
    const gone = vi.fn();
    const tap = vi.fn();
    await mount(<Toast text="Зварити пасту · час вийшов" onDismiss={gone} closable onTap={tap} />);
    const close = host!.querySelector<HTMLButtonElement>('[data-toast-close]')!;
    await act(async () => { close.click(); });
    expect(tap).not.toHaveBeenCalled(); // хрестик — не тап по тілу
    expect(gone).not.toHaveBeenCalled(); // ще не минуло 120мс фейду хрестика
  });

  it('onTap на тілі — фейд 120мс, потім onTap і onDismiss', async () => {
    const gone = vi.fn();
    const tap = vi.fn();
    await mount(<Toast text="Зварити пасту · час вийшов" onDismiss={gone} onTap={tap} />);
    const el = host!.querySelector<HTMLElement>('[data-toast]')!;
    await act(async () => { el.click(); });
    expect(tap).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(130); });
    expect(tap).toHaveBeenCalledTimes(1);
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('placement="chin": авто-зникнення через 4с — вихід 240мс (не 160)', async () => {
    const gone = vi.fn();
    await mount(<Toast text="Крок · час вийшов" onDismiss={gone} placement="chin" />);
    await act(async () => { vi.advanceTimersByTime(4_000); });
    await act(async () => { vi.advanceTimersByTime(160); }); // база (default) вже пройшла б, chin — ще ні
    expect(gone).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(90); }); // разом 250мс — chin (240) уже пройшов
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('placement="chin", ≥1024: під курсором пауза, після відходу — ще 2с (не залишок 4с)', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('min-width: 1024'), media: q, addEventListener() {}, removeEventListener() {} }));
    const gone = vi.fn();
    await mount(<Toast text="Крок · час вийшов" onDismiss={gone} placement="chin" />);
    const el = host!.querySelector<HTMLElement>('[data-toast]')!;
    await act(async () => { vi.advanceTimersByTime(3_000); }); // майже до кінця оригінальних 4с
    // React делегує onMouseEnter/Leave через нативні mouseover/mouseout
    // (mouseenter/mouseleave самі не спливають) — relatedTarget=null імітує
    // вхід/вихід ззовні дерева.
    await act(async () => { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null })); });
    await act(async () => { vi.advanceTimersByTime(10_000); }); // під курсором — довго, все одно тиша
    expect(gone).not.toHaveBeenCalled();
    await act(async () => { el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null })); });
    await act(async () => { vi.advanceTimersByTime(1_900); });
    expect(gone).not.toHaveBeenCalled(); // ще не 2с
    await act(async () => { vi.advanceTimersByTime(400); }); // 2с грації + 240мс виходу chin
    expect(gone).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('placement="chin" без window.matchMedia узагалі (jsdom-профіль без стабу) — наведення не падає', async () => {
    const gone = vi.fn();
    await mount(<Toast text="Крок · час вийшов" onDismiss={gone} placement="chin" />);
    const el = host!.querySelector<HTMLElement>('[data-toast]')!;
    // window.matchMedia лишається undefined (не стабили) — .matches на
    // undefined кидав би, якби optional chaining не покривав обидва хопи.
    await act(async () => { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null })); });
    await act(async () => { el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null })); });
    await act(async () => { vi.advanceTimersByTime(4_250); });
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('placement="chin", <1024: наведення НЕ ставить на паузу — звичайні 4с', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    const gone = vi.fn();
    await mount(<Toast text="Крок · час вийшов" onDismiss={gone} placement="chin" />);
    const el = host!.querySelector<HTMLElement>('[data-toast]')!;
    await act(async () => { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null })); });
    await act(async () => { vi.advanceTimersByTime(4_250); });
    expect(gone).toHaveBeenCalledTimes(1); // ≥1024-пауза не діє — звичайний авто-дисміс
    vi.unstubAllGlobals();
  });
});
