// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ActionState } from './ActionState';
import { IncidentStrips } from '../ErrorState/IncidentStrips';
import { useIncidentStore } from '../../store/incident';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  useIncidentStore.setState({ authExpired: false, throttledUntil: null, throttledFor: 0, throttledKind: null, offline: false, actionRowMounted: false });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });
const q = (s: string) => host.querySelector<HTMLElement>(s);
const base = { sending: false, waited: 0, parsing: false, nothingChanged: false, cardConflict: false };

describe('рядок стану дії над композитором', () => {
  it('ліміт із стору — hourglass і слово за kind; «Повторити» немає', async () => {
    await act(async () => { root.render(<ActionState {...base} />); });
    await act(async () => { useIncidentStore.getState().setThrottled(30, 'recipe_gen'); });
    expect(q('[data-action-state]')?.dataset.actionState).toBe('limit');
    expect(host.textContent).toContain('Десять рецептів');
    expect(q('[data-action]')).toBeNull();
    expect(q('[data-icon="live.limit"]')).toBeTruthy();
  });

  it('мережа — wifi-off і «Повторити», яке знімає офлайн', async () => {
    await act(async () => { root.render(<ActionState {...base} onRetry={() => useIncidentStore.getState().setOffline(false)} />); });
    await act(async () => { useIncidentStore.getState().setOffline(true); });
    expect(q('[data-action-state]')?.dataset.actionState).toBe('offline');
    expect(q('[data-icon="live.offline"]')).toBeTruthy();
    await act(async () => { q('[data-action="retry"]')!.click(); });
    expect(q('[data-action-state]')).toBeNull();
  });

  it('на стрічці смуги ліміту й мережі мовчать — рядок їх заміщує; сесія — ні', async () => {
    await act(async () => { root.render(<MemoryRouter><IncidentStrips /><ActionState {...base} /></MemoryRouter>); });
    await act(async () => { useIncidentStore.getState().setThrottled(30); useIncidentStore.getState().setOffline(true); });
    // Один стан — одна поверхня: рядок є, смуг за ці два стани немає.
    expect(q('[data-action-state]')).toBeTruthy();
    expect(host.querySelectorAll('[data-strip]').length).toBe(0);
    // Сесія — не стан дії, а стан входу: смугою завжди.
    await act(async () => { useIncidentStore.getState().setAuthExpired(true); });
    expect(host.querySelectorAll('[data-strip]').length).toBe(1);
  });

  it('без рядка (інший екран) смуги працюють як досі', async () => {
    await act(async () => { root.render(<MemoryRouter><IncidentStrips /></MemoryRouter>); });
    await act(async () => { useIncidentStore.getState().setThrottled(30); });
    expect(host.querySelectorAll('[data-strip]').length).toBe(1);
  });

  it('«нічого не змінилось» — minus, без дії; конфлікт картки — «Оновити»', async () => {
    await act(async () => { root.render(<ActionState {...base} nothingChanged />); });
    expect(q('[data-action-state]')?.dataset.actionState).toBe('nothing');
    expect(q('[data-icon="live.nothing"]')).toBeTruthy();
    expect(q('[data-action]')).toBeNull();
    let refreshed = 0;
    await act(async () => { root.render(<ActionState {...base} cardConflict onRefresh={() => { refreshed++; }} />); });
    expect(q('[data-action-state]')?.dataset.actionState).toBe('conflict');
    await act(async () => { q('[data-action="refresh"]')!.click(); });
    expect(refreshed).toBe(1);
  });
});
