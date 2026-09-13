// @vitest-environment jsdom
// Аудит 0913 C.7: у RecipeLinkCard `if (!rid) return null` стояв перед двома
// useContext (cards.tsx:904 → 957). Картка без recipe_id, що потім його
// отримує, міняла кількість хуків між рендерами.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Card } from './cards';
import type { ChatCard } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('RecipeLinkCard · порядок хуків', () => {
  let root: Root | undefined; let host: HTMLDivElement | undefined;
  let err: ReturnType<typeof vi.spyOn> | undefined;
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); err?.mockRestore(); });
  const render = async (card: ChatCard) => {
    if (!host) {
      err = vi.spyOn(console, 'error').mockImplementation(() => {});
      host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    }
    await act(async () => { root!.render(<MemoryRouter><Card card={card} /></MemoryRouter>); });
  };
  const errors = () => err!.mock.calls.flat().map(String).join(' ');

  it('без recipe_id — порожньо; recipe_id зʼявляється — посилання, без попереджень', async () => {
    await render({ type: 'recipe_link' } as ChatCard);
    expect(host!.innerHTML).toBe('');
    // Без recipe картка теж виходить рано (посилання) — до useContext доходить
    // лише повний рецепт, тому саме він і ловить зміну кількості хуків.
    const recipe = { t: 'Борщ', sv: 2, tm: 60, ch: '', d: '', rk: '', ing: [{ n: 'буряк', v: 1, u: 'pcs' }], st: [{ t: 'Варити', s: 0 }] };
    await render({ type: 'recipe_link', recipe_id: 'r1', title: 'Борщ', recipe } as unknown as ChatCard);
    expect(host!.textContent).toContain('Борщ');
    expect(errors()).not.toMatch(/Rendered more hooks|change in the order of Hooks/);
  });
});
