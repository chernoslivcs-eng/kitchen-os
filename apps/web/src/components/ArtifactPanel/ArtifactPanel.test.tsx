// @vitest-environment jsdom
//
// Пул-9 №6: новий артефакт виходить наперед.
//
// Було: панель рахувала додані ключі, але лише ставила крапку на згорнутій
// смузі, а `shown` лишався `active ?? artifacts[0]` — рецепт чи кошик, що
// прийшов із чату, доводилось відкривати руками.
//
// Три межі, і всі три перевіряються тут: новий ключ із ходу стає активним;
// ручне перемикання за останні 10 с не перебивається; завантаження історії
// панель не відкриває.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ArtifactPanel } from './ArtifactPanel';
import { usePanelStore, type PanelArtifact, MANUAL_PICK_GRACE_MS } from '../../store/panel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const art = (key: string, label = key): PanelArtifact => ({ key, kind: 'recipe', label, meta: '' });

async function publish(artifacts: PanelArtifact[], freshKeys: string[] = []) {
  await act(async () => {
    usePanelStore.getState().publish({ artifacts, render: () => null, freshKeys });
  });
}

const active = () => usePanelStore.getState().active;

beforeEach(async () => {
  // matchMedia у jsdom немає — панель питає її, щоб знати, вона в потоці чи шторка.
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: true, media: q, addEventListener() {}, removeEventListener() {},
  }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  // Тінь над низом панелі рахується в rAF і до цих тестів не має стосунку —
  // без заглушки вона б'є стан уже поза act().
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  usePanelStore.setState({
    artifacts: [], freshKeys: [], active: null, lastManualPick: 0,
    hidden: false, fresh: false, open: false,
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<ArtifactPanel />); });
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.unstubAllGlobals();
});

describe('новий артефакт виходить наперед', () => {
  it('ключ із ходу стає активним і замінює те, що було відкрито', async () => {
    await publish([art('recipe-1')], []);
    await act(async () => { usePanelStore.getState().setActive('recipe-1'); });
    // Ручний вибір давній — не заважає.
    usePanelStore.setState({ lastManualPick: Date.now() - MANUAL_PICK_GRACE_MS - 1 });

    await publish([art('recipe-1'), art('cart-2')], ['cart-2']);
    expect(active()).toBe('cart-2');
  });

  it('згорнута панель розгортається під новий артефакт', async () => {
    await publish([art('list')], []);
    usePanelStore.setState({ hidden: true, lastManualPick: 0 });
    await publish([art('list'), art('recipe-9')], ['recipe-9']);
    expect(usePanelStore.getState().hidden).toBe(false);
    expect(active()).toBe('recipe-9');
  });

  it('людина перемкнула руками за останні 10 с — не перебиваємо', async () => {
    await publish([art('list'), art('recipe-1')], []);
    // Рука: людина відкрила список покупок просто зараз.
    await act(async () => { usePanelStore.getState().setActive('list'); });

    await publish([art('list'), art('recipe-1'), art('recipe-2')], ['recipe-2']);
    expect(active()).toBe('list');
  });

  it('той самий випадок на згорнутій панелі лишає крапку, а не розгортає', async () => {
    await publish([art('list')], []);
    await act(async () => { usePanelStore.getState().setActive('list'); });
    usePanelStore.setState({ hidden: true, fresh: false });

    await publish([art('list'), art('recipe-2')], ['recipe-2']);
    expect(usePanelStore.getState().hidden).toBe(true);
    expect(usePanelStore.getState().fresh).toBe(true);
    expect(active()).toBe('list');
  });

  it('завантаження історії панель не відкриває', async () => {
    // Стрічка публікує порожньо, потім історія приїжджає одним стрибком —
    // ключі нові, але жоден не з ходу цієї вкладки.
    usePanelStore.setState({ hidden: true });
    await publish([], []);
    await publish([art('h1'), art('h2'), art('h3')], []);
    expect(usePanelStore.getState().hidden).toBe(true);
    expect(active()).toBeNull();
  });
});
