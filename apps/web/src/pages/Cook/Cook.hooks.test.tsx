// @vitest-environment jsdom
// Аудит 0913 C.7: guard `if (!recipe) return null` стояв ПЕРЕД useRef/useEffect/
// useState (Cook.tsx:352 → 359–390) всупереч власному коментарю. Поки recipe
// не міняється в межах монтування — мовчить; цей тест тримає порядок хуків.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { CookOverlay } from './Cook';
import { useCookStore } from '../../store/cook';
import type { Recipe } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const recipe: Recipe = {
  t: 'Яєчня', sv: 1, tm: 5, ch: '', d: '', rk: '', ing: [],
  st: [{ t: 'Розбити яйця', s: 0 }, { t: 'Смажити', s: 120 }] as Recipe['st'],
};

describe('CookOverlay · порядок хуків', () => {
  let root: Root | undefined; let host: HTMLDivElement | undefined;
  let err: ReturnType<typeof vi.spyOn> | undefined;
  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    host?.remove(); err?.mockRestore(); useCookStore.setState({ args: null });
  });
  const mount = async () => {
    err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<MemoryRouter><CookOverlay /></MemoryRouter>); });
  };
  const errors = () => err!.mock.calls.flat().map(String).join(' ');

  it('без recipe — порожньо і жодного попередження React', async () => {
    useCookStore.setState({ args: null });
    await mount();
    expect(host!.innerHTML).toBe('');
    expect(errors()).toBe('');
  });

  it('recipe зʼявляється після монтування — хуків не стає більше', async () => {
    useCookStore.setState({ args: null });
    await mount();
    await act(async () => { useCookStore.setState({ args: { recipe } }); });
    expect(host!.textContent).toContain('Розбити яйця');
    expect(errors()).not.toMatch(/Rendered more hooks|change in the order of Hooks/);
  });
});
