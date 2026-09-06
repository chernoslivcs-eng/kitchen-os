// @vitest-environment jsdom
//
// Крок С1: сайдбар скролиться цілком.
//
// Скрол мав лише блок сесій, а цілі, «ЗАРАЗ» і роздільник були прибиті до
// колонки. На короткому екрані три активні події з'їдали висоту, список сесій
// стискався до рядка-двох або зникав, і до «Історія →» не було як дістатись.
//
// CSS-модулі у vitest резолвляться в порожній об'єкт, тому геометрію тут не
// перевірити в принципі. Перевіряється те, що ламалось і що можна перевірити
// чесно: СТРУКТУРА (хто всередині скрольованого блока, хто поза ним) — по DOM,
// і відсутність вкладеного скролу — по тексту самого CSS-модуля.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { TabBar } from './TabBar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const json = (o: unknown) =>
  new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

const session = (i: number) => ({
  id: `s${i}`, user_id: 'u1', title: `розмова ${i}`,
  day: '2026-09-06', created_at: '2026-09-06T09:00:00Z', message_count: 4,
});

// Живий склад короткого екрана з завдання: три активні події і шість сесій.
function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/v1/now')) {
      return json({ now: [
        { id: 'n1', title: 'Великий піст', from: '2026-03-02', to: '2026-04-18', strict: true },
        { id: 'n2', title: 'Полуниця', from: '2026-05-20', to: '2026-07-10', strict: false },
        { id: 'n3', title: 'Мама на тиждень', from: '2026-09-05', to: '2026-09-12', strict: false },
      ] });
    }
    if (url === '/v1/shopping') return json({ count: 3, items: [] });
    if (url === '/v1/sessions') return json({ sessions: [1, 2, 3, 4, 5, 6].map(session) });
    return json({});
  }));
}

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter><TabBar /></MemoryRouter>); });
}

const scroll = () => host!.querySelector<HTMLElement>('[data-nav-scroll]');
const byText = (t: string) =>
  [...host!.querySelectorAll('button')].find((b) => b.textContent?.includes(t));

beforeEach(() => { installFetch(); });
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.unstubAllGlobals();
});

describe('скрольований стовпчик сайдбара', () => {
  it('усе від цілей до «Історія →» — в одному скрольованому блоці', async () => {
    await mount();
    const box = scroll();
    expect(box).toBeTruthy();

    // Верхня межа стрічки — перша ціль.
    expect(box!.contains(byText('Стрічка')!)).toBe(true);
    expect(box!.contains(byText('Календар')!)).toBe(true);
    // «ЗАРАЗ» їде разом з усіма, а не тисне на список знизу.
    expect(box!.textContent).toContain('ЗАРАЗ');
    expect(box!.contains(byText('Великий піст')!)).toBe(true);
    // Нижня межа — саме «Історія →»: заради неї крок і робився.
    const archive = byText('Історія →');
    expect(archive).toBeTruthy();
    expect(box!.contains(archive!)).toBe(true);
  });

  it('бренд і профіль лишаються поза скролом — вони справді закріплені', async () => {
    await mount();
    const box = scroll()!;
    expect(box.textContent).not.toContain('Kitchen OS');
    const profile = byText('Профіль');
    expect(profile).toBeTruthy();
    expect(box.contains(profile!)).toBe(false);
  });

  it('спейсера більше немає — висоту забирає сам скрольований блок', async () => {
    await mount();
    // Порожній div із flex:1 поруч зі скролом ділив би вільне місце навпіл.
    const wrap = scroll()!.parentElement!;
    const empties = [...wrap.children].filter((el) => el.tagName === 'DIV' && !el.textContent?.trim());
    expect(empties).toHaveLength(0);
  });
});

describe('вкладеного скролу немає', () => {
  // Перевірка по тексту модуля, а не по DOM: у vitest CSS-модуль порожній, а
  // саме друга смуга прокрутки — те, що тут може повернутись непомітно.
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'TabBar.module.css'),
    'utf8',
  );
  const blocks = (selector: string) =>
    [...css.matchAll(new RegExp(`(^|\\s)\\${selector}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[2]!);

  it('.sessions не має власного overflow-y', () => {
    const found = blocks('.sessions');
    expect(found.length).toBeGreaterThan(0);
    for (const body of found) expect(body).not.toMatch(/overflow-y/);
  });

  it('.scroll скролиться і вміє стискатись', () => {
    const found = blocks('.scroll');
    expect(found.length).toBeGreaterThan(0);
    const main = found.find((b) => b.includes('overflow-y'))!;
    expect(main).toBeTruthy();
    // min-height: 0 — без нього flex-нащадок не стискається і скрол не з'явиться.
    expect(main).toMatch(/min-height:\s*0/);
    expect(main).toMatch(/scrollbar-width:\s*thin/);
  });
});
