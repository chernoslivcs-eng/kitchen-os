// @vitest-environment jsdom
// Р116 (рішення власника 12.09): «Дім зараз» на ≥704 — вікно, не накладка.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HomeNowPanel } from './HomeNow';
import type { HomeNow } from '../../store/homeNow';

const home: HomeNow = { facts: { count: 20, soon: 2, overdue: 2 }, overdue: 2, burning: [], now: [], strict: null, shopping: null };

describe('«Дім зараз» — вікно (Р116)', () => {
  let root: Root | null = null; let host: HTMLDivElement;
  afterEach(() => { act(() => root?.unmount()); host?.remove(); });

  function mount(sheet: boolean, onClose = vi.fn()) {
    host = document.createElement('div'); document.body.appendChild(host);
    const chip = document.createElement('button'); chip.dataset.chipHome = ''; document.body.appendChild(chip); chip.focus();
    root = createRoot(host);
    act(() => root!.render(<HomeNowPanel home={home} cookLive={null} sheet={sheet} onClose={onClose} onCook={() => {}} onOverdue={() => {}} onCalendar={() => {}} onList={() => {}} onAsk={() => {}} dateLabel="пт, 12 вер" />));
    return { chip, onClose };
  }

  it('форма dialog: центроване вікно з темним скримом, фокус на ✕, головна кнопка «Що на вечерю?»', () => {
    const { chip } = mount(false);
    const dlg = host.querySelector<HTMLElement>('[data-home-now]')!;
    expect(dlg.dataset.homeForm).toBe('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Закрити');
    expect(host.querySelector('[data-home-ask]')?.textContent).toBe('Що на вечерю?');
    // Закриття повертає фокус на чіп.
    act(() => root!.unmount()); root = null;
    expect(document.activeElement).toBe(chip);
    chip.remove();
  });

  it('Esc закриває; шторка (390) лишається як була — посилання, без перехоплення фокуса', () => {
    const { onClose } = mount(true);
    expect(host.querySelector<HTMLElement>('[data-home-now]')!.dataset.homeForm).toBe('sheet');
    expect(host.querySelector('[data-home-ask]')).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).not.toBe('Закрити');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalled();
    document.querySelector('[data-chip-home]')?.remove();
  });
});
