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
    expect(box!.contains(byText('Чат')!)).toBe(true);
    expect(box!.contains(byText('Календар')!)).toBe(true);
    // 6b-5: «ЗАРАЗ» із сайдбара пішов у шапку чату й панель «Дім зараз»;
    // між цілями і сесіями — рядок «Розмови · + Нова», і він теж у скролі.
    expect(box!.textContent).toContain('Розмови');
    expect(box!.textContent).not.toContain('ЗАРАЗ');
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

// Етап 6a (11.09): одна навігація в чотирьох контейнерах — рейка 60 ⇄
// сайдбар 256 однією кнопкою (стан у localStorage), нижній бар <768 (⚠6),
// класи на <body>, які зсувають контент і ховають бар.
import { useNavStore } from '../../store/nav';

describe('оболонка 6a', () => {
  beforeEach(() => { localStorage.clear(); useNavStore.setState({ expanded: false, open: false }); });

  it('кнопка «панель» на ≥1024 перемикає сайдбар: клас на body і памʼять у localStorage', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    await mount();
    expect(document.body.classList.contains('nav-expanded')).toBe(false);
    await act(async () => { host!.querySelector<HTMLButtonElement>('[data-panel-btn]')!.click(); });
    expect(document.body.classList.contains('nav-expanded')).toBe(true);
    expect(localStorage.getItem('kos-nav-expanded')).toBe('1');
    await act(async () => { host!.querySelector<HTMLButtonElement>('[data-panel-btn]')!.click(); });
    expect(document.body.classList.contains('nav-expanded')).toBe(false);
    expect(localStorage.getItem('kos-nav-expanded')).toBe('0');
  });

  it('та сама кнопка нижче 1024 відкриває шухляду, а не сайдбар', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
    await mount();
    await act(async () => { host!.querySelector<HTMLButtonElement>('[data-panel-btn]')!.click(); });
    expect(useNavStore.getState().open).toBe(true);
    expect(document.body.classList.contains('nav-expanded')).toBe(false);
  });

  // Prototype nav: у рейці кнопки «панель» немає — розгортає сам логотип.
  it('логотип у рейці — той самий тогл: ≥1024 сайдбар, нижче — шухляда', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    await mount();
    await act(async () => { host!.querySelector<HTMLButtonElement>('[data-brand-btn]')!.click(); });
    expect(document.body.classList.contains('nav-expanded')).toBe(true);
    await act(async () => { host!.querySelector<HTMLButtonElement>('[data-brand-btn]')!.click(); });
    expect(document.body.classList.contains('nav-expanded')).toBe(false);
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
    await act(async () => { host!.querySelector<HTMLButtonElement>('[data-brand-btn]')!.click(); });
    expect(useNavStore.getState().open).toBe(true);
  });

  it('нижній бар — пʼять цілей, активна позначена; бейдж списку на місці', async () => {
    await mount();
    const bar = host!.querySelector('[data-tab-bar]')!;
    const tabs = [...bar.querySelectorAll('button')];
    expect(tabs.map((b) => b.textContent?.replace(/\d+/g, '').trim())).toEqual(['Чат', 'Комора', 'Рецепти', 'Список', 'Календар']);
    expect(tabs.filter((b) => b.getAttribute('aria-current') === 'page').length).toBeLessThanOrEqual(1);
    expect(bar.textContent).toContain('3');
  });

  it('CSS: бар ховається за body.composer-focused і body.sheet-open; сайдбар 256 за .wide (закріплено чи оверлей)', () => {
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'TabBar.module.css'), 'utf8');
    expect(css).toMatch(/body\.composer-focused\)\s*\.bar,?\s*\n?\s*:global\(body\.sheet-open\)\s*\.bar\s*\{\s*transform: translateY/);
    // №14: розкладку 256 несе клас .wide (закріплено АБО оверлей з наведення);
    // зсув контенту — body.nav-expanded у tokens.css.
    expect(css).toMatch(/\.wrap\.wide \{\s*width: 256px/);
    expect(css).toMatch(/\.wrap\.peek \{[^}]*z-index: 30/);
    expect(css).toMatch(/\.wrap \{[^}]*width: 60px/);
  });
});

// FIXES-V3 №13 · №14 · №18 · №19 (рішення власника).
describe('пакет правок 1 · сайдбар', () => {
  const fine = (on: boolean) => vi.stubGlobal('matchMedia', vi.fn((q: string) => ({ matches: on && q.includes('pointer: fine'), addEventListener: vi.fn(), removeEventListener: vi.fn() })));

  it('№13: кнопка «панель» стоїть у низу поруч із рядком профілю, шеврона в рядку нема, весь рядок веде в профіль', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    await mount();
    const btn = host!.querySelector('[data-panel-btn]')!;
    const user = host!.querySelector('[aria-label="Профіль"]')!;
    expect(btn.parentElement).toBe(user.parentElement);
    expect(user.querySelector('[data-icon="sys.next"]')).toBeNull();
    expect(host!.querySelector('[data-nav] > div:first-child [data-panel-btn]'), 'у шапці кнопки нема').toBeNull();
  });

  it('№14: наведення на рейку (вказівник) — оверлей data-peek без body.nav-expanded; відхід — зникає за 150 мс; клік по кнопці — закріплює', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    fine(true);
    vi.useFakeTimers();
    await mount();
    const nav = host!.querySelector<HTMLElement>('[data-nav]')!;
    // React синтезує enter/leave з pointerover/pointerout.
    const enter = () => nav.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: document.body }));
    const leave = () => nav.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
    await act(async () => { enter(); });
    expect(nav.dataset.peek).toBe('true');
    expect(document.body.classList.contains('nav-expanded')).toBe(false);
    await act(async () => { leave(); });
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(nav.dataset.peek, 'ще не зник — затримка проти мигання').toBe('true');
    await act(async () => { vi.advanceTimersByTime(80); });
    expect(nav.dataset.peek).toBeUndefined();
    await act(async () => { enter(); });
    await act(async () => { host!.querySelector<HTMLButtonElement>('[data-panel-btn]')!.click(); });
    expect(document.body.classList.contains('nav-expanded'), 'закріплено').toBe(true);
    expect(nav.dataset.peek).toBeUndefined();
    vi.useRealTimers();
  });

  it('№14: на дотику наведення нічого не розгортає', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    fine(false);
    await mount();
    const nav = host!.querySelector<HTMLElement>('[data-nav]')!;
    await act(async () => { nav.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: document.body })); });
    expect(nav.dataset.peek).toBeUndefined();
  });

  it('№18 · №19: рядок розмови — назва без часу; хрестик — постійний слот у рядку', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    await mount();
    const x = host!.querySelector<HTMLElement>('[data-nav] button[aria-label^="Видалити"]')!;
    const row = x.previousElementSibling!;
    expect(row.textContent).not.toMatch(/\d{2}:\d{2}/);
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'TabBar.module.css'), 'utf8');
    const xRule = css.slice(css.indexOf('.session-x {'), css.indexOf('}', css.indexOf('.session-x {')));
    expect(xRule).not.toMatch(/position: absolute/);
    expect(xRule).toMatch(/width: 28px; height: 28px/);
    expect(css).not.toMatch(/session-when/);
  });
});
