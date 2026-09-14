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

// Порційник у панелі (14.09, рішення власника): степер у шапці «Склад · N»,
// кількості й статус «можу зараз · N з M» — по вибраних порціях, onCook —
// перерахований рецепт. Стан не зберігається.
import { LivePositions, type LivePosition } from './cards';

describe('RecipeLinkCard · порційник', () => {
  let root: Root | undefined; let host: HTMLDivElement | undefined;
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); root = undefined; host = undefined; });

  const recipe = {
    t: 'Паста', sv: 2, tm: 20, ch: '', d: '', rk: '',
    ing: [
      { p: 'b1', n: 'паста', v: 200, u: 'g' },      // партія 300 г: на 2 — є, на 4 (400) — бракує
      { p: 'b2', n: 'олія', v: 20, u: 'ml' },       // партія 1 л: завжди є
      { p: 'b3', n: 'яйця', v: 2, u: 'pcs' },       // партія у г: незіставно → є
      { n: 'базилік', v: 10, u: 'g' },              // без партії: бракує завжди
    ],
    st: [{ t: 'Варити', c: 'x' }],
  };
  const positions = new Map<string, LivePosition>([
    ['b1', { label: 'Паста', value: 300, unit: 'g' }],
    ['b2', { label: 'Олія', value: 1, unit: 'l' }],
    ['b3', { label: 'Яйця', value: 500, unit: 'g' }],
  ]);
  const onCook = vi.fn(); const onNeedToList = vi.fn();
  async function mount() {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    const card = { type: 'recipe_link', recipe_id: 'r1', title: 'Паста', recipe } as unknown as ChatCard;
    await act(async () => {
      root!.render(<MemoryRouter><LivePositions.Provider value={positions}><Card card={card} onCook={onCook} onNeedToList={onNeedToList} /></LivePositions.Provider></MemoryRouter>);
    });
  }
  const more = () => host!.querySelector<HTMLButtonElement>('[data-recipe-ings] button[aria-label="Більше порцій"]')!;
  const status = () => host!.querySelector('[data-recipe-status]')!.textContent;
  const missing = () => [...host!.querySelectorAll('[data-recipe-ings] [data-missing]')].map((el) => el.textContent);

  it('степер стоїть у шапці «Склад»; на sv рецепта статус «майже · 3 з 4»', async () => {
    await mount();
    expect(more()).toBeTruthy();
    expect(host!.querySelector('[data-servings]')!.textContent).toBe('2 порції');
    expect(status()).toContain('майже · 3 з 4');
    expect(missing()).toHaveLength(1);
  });

  it('+ → 4 порції: кількості ×2, паста 400 г проти 300 г — бракує, статус «2 з 4», у список — 400 г', async () => {
    await mount();
    await act(async () => { more().click(); });
    await act(async () => { more().click(); });
    expect(host!.querySelector('[data-servings]')!.textContent).toBe('4 порції');
    expect(status()).toContain('2 з 4');
    const miss = missing();
    expect(miss).toHaveLength(2);
    expect(miss.join(' ')).toContain('400 г');
    // олія 40 мл проти 1 л і яйця (шт проти г) — лишаються «є».
    await act(async () => { host!.querySelector<HTMLButtonElement>('[data-recipe-tolist]')!.click(); });
    expect(onNeedToList).toHaveBeenCalledWith('паста', 400, 'g', 'Паста');
    await act(async () => { host!.querySelector<HTMLButtonElement>('[data-cook-go]')!.click(); });
    const sent = onCook.mock.calls.at(-1)![0];
    expect(sent.sv).toBe(4);
    expect(sent.ing[0].v).toBe(400);
  });
});
