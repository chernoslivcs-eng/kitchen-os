// @vitest-environment jsdom
// Етап 5, п.6: «Приготували», а POST /v1/cook-runs не пройшов. Людину в
// пастці не тримаємо (Cook Mode закривається), але й не мовчимо: тіло
// запиту лягає у сховок, смуга каже «не записалось», «Повторити» шле ТОЙ
// САМИЙ запит. Перевіряється на межі API: що саме летить у POST.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { IncidentStrips } from './IncidentStrips';
import { COOK_UNSAVED_STRIP } from './copy';
import { useIncidentStore } from '../../store/incident';
import { stashUnsavedRun, loadUnsavedRun, clearUnsavedRun, type UnsavedRun } from '../../lib/cook-session';
import type { Recipe } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const recipe = { t: 'Борщ', sv: 4, tm: 100, ch: 'домашнє', d: '', rk: '', ing: [{ n: 'буряк', v: 300, u: 'г' }], st: [{ t: 'Зварити.', c: '' }] } as Recipe;
const run: UnsavedRun = { recipe, opts: { skip_pantry: true, recipe_id: 'r1', session_id: 's1', ask_writeoff: true }, at: 1 };

describe('незаписане готування', () => {
  let host: HTMLDivElement | undefined; let root: Root | undefined;
  let posts: { url: string; body: unknown }[] = [];
  let status = 500;
  beforeEach(() => {
    posts = []; status = 500;
    clearUnsavedRun();
    useIncidentStore.setState({ authExpired: false, throttledUntil: null, throttledFor: 0, offline: false, unsavedCook: null });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { posts.push({ url, body: JSON.parse(init.body as string) }); return new Response(status === 200 ? '{"id":"cr1"}' : '{"error":"boom"}', { status, headers: { 'content-type': 'application/json' } }); }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));
  });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); clearUnsavedRun(); });
  async function mount() {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<MemoryRouter><IncidentStrips /></MemoryRouter>); });
  }
  const strip = () => host!.querySelector('[data-strip-kind="cook_unsaved"]');
  const cta = () => [...host!.querySelectorAll('button')].find((b) => b.textContent?.trim() === COOK_UNSAVED_STRIP.cta) ?? null;

  it('сховок переживає перезавантаження: стор читає localStorage', () => {
    stashUnsavedRun(run);
    expect(loadUnsavedRun()?.recipe.t).toBe('Борщ');
  });

  it('смуга видима, поки запис не пройшов; «Повторити» шле той самий запит; 500 — смуга лишається, 200 — зникає і сховок порожній', async () => {
    stashUnsavedRun(run);
    useIncidentStore.setState({ unsavedCook: run });
    await mount();
    expect(strip()).not.toBeNull();
    expect(host!.textContent).toContain(COOK_UNSAVED_STRIP.h1b);

    await act(async () => { cta()!.click(); });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toContain('/v1/cook-runs');
    // Те саме тіло, що не пройшло з Cook Mode: рецепт + ті самі опції.
    expect(posts[0]!.body).toEqual({ recipe, skip_pantry: true, recipe_id: 'r1', session_id: 's1', ask_writeoff: true });
    expect(strip()).not.toBeNull();
    expect(loadUnsavedRun()).not.toBeNull();

    status = 200;
    await act(async () => { cta()!.click(); });
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).toEqual(posts[0]!.body);
    expect(strip()).toBeNull();
    expect(loadUnsavedRun()).toBeNull();
    expect(useIncidentStore.getState().unsavedCook).toBeNull();
  });

  it('без сховку смуги нема', async () => {
    await mount();
    expect(strip()).toBeNull();
  });
});
