// @vitest-environment jsdom
//
// FIXES-V3 №21: нижній бар ховається ЛИШЕ за body.composer-focused і
// body.sheet-open — і після закриття будь-якої шторки/меню обох класів нема.
// Витік був у двох власників одного класу й у демонтажі композитора у фокусі.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { holdBodyFlag, bodyFlagHolders } from './body-flags';
import { Sheet } from '../components/Sheet/Sheet';
import { ArtifactPanel } from '../components/ArtifactPanel/ArtifactPanel';
import { usePanelStore } from '../store/panel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined; let host: HTMLDivElement | undefined;
const mount = async (el: React.ReactElement) => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); await act(async () => { root!.render(el); }); };
const has = (c: string) => document.body.classList.contains(c);
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); root = undefined; usePanelStore.getState().clear(); });

describe('№21 · класи бару на body', () => {
  it('лічильник: клас стоїть, поки тримає хоч один власник; release двічі — не мінус', () => {
    const a = holdBodyFlag('sheet-open'); const b = holdBodyFlag('sheet-open');
    expect(has('sheet-open')).toBe(true);
    a(); a();
    expect(has('sheet-open'), 'другий власник ще тримає').toBe(true);
    expect(bodyFlagHolders('sheet-open')).toBe(1);
    b();
    expect(has('sheet-open')).toBe(false);
  });

  it('шторка Sheet поруч із відкритою шторкою панелі: закриття Sheet клас панелі не знімає; закриття панелі — обох нема', async () => {
    usePanelStore.getState().publish({ artifacts: [{ key: 'x', kind: 'batch', label: 'X', meta: '' }], render: () => null });
    await mount(<><ArtifactPanel /><Sheet onClose={() => {}} ariaLabel="s">…</Sheet></>);
    await act(async () => { usePanelStore.getState().setOpen(true); });
    expect(has('sheet-open')).toBe(true);
    await act(async () => { root!.render(<ArtifactPanel />); });   // Sheet закрилась
    expect(has('sheet-open'), 'шторка панелі ще відкрита').toBe(true);
    await act(async () => { usePanelStore.getState().setOpen(false); });
    expect(has('sheet-open')).toBe(false);
    expect(has('composer-focused')).toBe(false);
  });
});
