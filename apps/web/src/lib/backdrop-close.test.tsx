// @vitest-environment jsdom
// KOS-TEST-REPORT п. 4 («Зламано»): затемнення й мертві тапи на iPhone.
// Гіпотеза: тап по бекдропу в Safari iOS не дає click на «неклікабельному»
// div із делегованим React-слухачем. Бекдропи закриваються і по pointerup, і
// по click — але рівно один раз на дотик.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { useBackdropClose } from './backdrop-close';
import { Sheet } from '../components/Sheet/Sheet';
import { TabBar } from '../components/TabBar/TabBar';
import { ArtifactPanel } from '../components/ArtifactPanel/ArtifactPanel';
import { useNavStore } from '../store/nav';
import { usePanelStore } from '../store/panel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined; let host: HTMLDivElement | undefined;
async function mount(node: React.ReactNode) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(node); });
}
beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); vi.unstubAllGlobals(); });

const fire = (el: Element, type: string, init: PointerEventInit = {}) =>
  act(async () => { el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, button: 0, ...init })); });
const tap = async (el: Element) => { await fire(el, 'pointerup'); await fire(el, 'click'); };

function Probe({ onClose }: { onClose: () => void }) {
  const props = useBackdropClose(onClose);
  return <div data-probe {...props}><span data-child>x</span></div>;
}

describe('useBackdropClose', () => {
  it('pointerup + click одного дотику → закриття рівно раз; сам click (миша) → раз', async () => {
    const onClose = vi.fn();
    await mount(<Probe onClose={onClose} />);
    const el = host!.querySelector('[data-probe]')!;
    await tap(el);
    expect(onClose).toHaveBeenCalledTimes(1);
    // Наступний окремий клік (миша, пізніше) — знову закриває.
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
    await fire(el, 'click');
    now.mockRestore();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
  it('дотик по дитині всередині бекдропа не закриває', async () => {
    const onClose = vi.fn();
    await mount(<Probe onClose={onClose} />);
    await tap(host!.querySelector('[data-child]')!);
    expect(onClose).not.toHaveBeenCalled();
  });
  it('бекдроп має cursor: pointer (iOS: інакше click не приходить)', async () => {
    await mount(<Probe onClose={() => {}} />);
    expect(host!.querySelector<HTMLElement>('[data-probe]')!.style.cursor).toBe('pointer');
  });
});

describe('три бекдропи закриваються по pointerup', () => {
  it('Sheet', async () => {
    const onClose = vi.fn();
    await mount(<Sheet onClose={onClose} ariaLabel="x"><button>ok</button></Sheet>);
    vi.useFakeTimers();
    await fire(host!.querySelector('[data-sheet]')!.parentElement!, 'pointerup');
    await act(async () => { vi.runAllTimers(); });
    vi.useRealTimers();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('TabBar: шухляда відкрита → pointerup по бекдропу → закрита', async () => {
    useNavStore.setState({ open: true });
    await mount(<MemoryRouter><TabBar /></MemoryRouter>);
    const bd = host!.querySelector('[data-nav-backdrop]')!;
    await fire(bd, 'pointerup');
    expect(useNavStore.getState().open).toBe(false);
  });
  it('ArtifactPanel: шторка відкрита → pointerup по скріму → закрита', async () => {
    usePanelStore.setState({ artifacts: [{ key: 'a', kind: 'recipe', label: 'a', meta: '' }], render: () => null, open: true, hidden: false, active: 'a' });
    await mount(<ArtifactPanel />);
    const scrim = host!.querySelector('[data-rail-scrim]')!;
    await fire(scrim, 'pointerup');
    expect(usePanelStore.getState().open).toBe(false);
  });
});
