// @vitest-environment jsdom
// KOS-TEST-REPORT п. 4, раунд 3 (Safari iOS 390, стабільно): шторку артефакта
// закрили змахом → відкрили знову → скрім є, sheet-open є, а сама шторка стоїть
// за екраном: useSheetDrag після «leaving» лишається в цій фазі назавжди, а
// хук панелі живе в каркасі (Shell) і на повторному open віддає той самий
// inline transform: translateY(110%). Тест: закрити будь-яким способом →
// відкрити знову → aside без зсуву, скрім закриває.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ArtifactPanel } from './ArtifactPanel';
import { usePanelStore } from '../../store/panel';
import { SHEET_SETTLE_MS } from '../../lib/useSheetDrag';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined; let host: HTMLDivElement | undefined;
const pe = (type: string, y: number) => new PointerEvent(type, { bubbles: true, clientY: y, pointerId: 1, pointerType: 'touch', button: 0, isPrimary: true });

beforeEach(async () => {
  // Шторка (<600): ARTIFACT_SHEET збігається, панель у потоці — ні.
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  usePanelStore.setState({ artifacts: [{ key: 'r1', kind: 'recipe', label: 'Паста', meta: '' }], render: () => null, freshKeys: [], active: 'r1', lastManualPick: 0, hidden: false, fresh: false, open: false });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<ArtifactPanel />); });
});
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const aside = () => host!.querySelector<HTMLElement>('aside')!;
const open = () => act(async () => { usePanelStore.getState().setOpen(true); });
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function swipeClose() {
  const grab = host!.querySelector<HTMLElement>('[data-sheet-grab]')!;
  await act(async () => { grab.dispatchEvent(pe('pointerdown', 100)); });
  await act(async () => { grab.dispatchEvent(pe('pointermove', 250)); });
  await act(async () => { grab.dispatchEvent(pe('pointerup', 250)); });
  await wait(SHEET_SETTLE_MS + 40);
}

describe('шторка артефакта: закрити → відкрити знову', () => {
  it('після змаху вниз повторне відкриття показує шторку без зсуву за екран', async () => {
    await open();
    expect(aside().className).toContain('rail-open');
    await swipeClose();
    expect(usePanelStore.getState().open).toBe(false);
    await open();
    expect(aside().className).toContain('rail-open');
    expect(aside().style.transform).toBe('');
    // і скрім далі закриває
    await act(async () => { host!.querySelector<HTMLElement>('[data-rail-scrim]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(usePanelStore.getState().open).toBe(false);
  });
  it('після ✕ і після скріму — те саме', async () => {
    await open();
    await act(async () => { host!.querySelector<HTMLElement>('aside button[aria-label="Згорнути панель"]')!.click(); });
    expect(usePanelStore.getState().open).toBe(false);
    await open(); expect(aside().style.transform).toBe('');
    await act(async () => { host!.querySelector<HTMLElement>('[data-rail-scrim]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(usePanelStore.getState().open).toBe(false);
    await open(); expect(aside().className).toContain('rail-open'); expect(aside().style.transform).toBe('');
  });
});
