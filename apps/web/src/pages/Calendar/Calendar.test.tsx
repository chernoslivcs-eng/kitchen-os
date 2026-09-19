// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// 15.09: файл із монтуванням сторінки й кількома кліками на тест іде довго на
// раннері CI під --parallel; 5 с на тест давали флейк.
vi.setConfig({ testTimeout: 20_000 });
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { CalendarPage } from './Calendar';
import { CALENDAR_FAILED } from '../../components/ErrorState/copy';
import { usePanelStore } from '../../store/panel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// К9 (рішення 19.09, «мінімум»): сьогодні субота 19.09.2026 — той самий
// день, що в calendar-minimal-0919.html.
const FIXED_NOW = '2026-09-19T10:00:00';
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (offset: number, h = 0) => { const d = new Date(2026, 8, 19, h); d.setDate(d.getDate() + offset); return d; };

function jsonRes(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
}

describe('CalendarPage · збій завантаження', () => {
  let host: HTMLDivElement | undefined; let root: Root | undefined;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(FIXED_NOW)); });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('500 на /v1/events → тост із повтором; повтор приносить події й знімає тост', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })));
    let eventsStatus = 500;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/v1/now')) return jsonRes({ now: [] });
      if (url.includes('/v1/events')) return eventsStatus === 200 ? jsonRes({ events: [] }) : jsonRes({ error: 'boom' }, 500);
      return jsonRes({});
    }));
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<MemoryRouter><CalendarPage /></MemoryRouter>); });
    await act(async () => {});
    expect(host!.textContent).toContain(CALENDAR_FAILED.text);
    eventsStatus = 200;
    const retry = [...host!.querySelectorAll('button')].find((b) => b.textContent?.trim() === CALENDAR_FAILED.cta)!;
    await act(async () => { retry.click(); });
    await act(async () => {});
    expect(host!.textContent).not.toContain(CALENDAR_FAILED.text);
  });
});

// Наповнення К9 (той самий зміст, що в calendar-minimal-0919.html, дати
// перераховані на офсети від «сьогодні» 19.09): «Без молочного» — власна
// строга дієта, вже діє, кінець 05.10 (у «Далі» — рядок-кінець); «Гості на
// вечерю» — точкова подія СЬОГОДНІ (в «Сьогодні», не в «Далі»); «Мало часу» /
// «Замовлення Сільпо» — одноденні в майбутньому; «Набір ваги» — власний
// період, СТАРТУЄ в горизонті (рядок-старт І рядок-кінець); «Покрова» —
// каталожне свято; «Різдвяний піст» — каталожний тривалий (лише старт);
// «Сливи»/«Білі гриби» — сезони (лише в «Сьогодні», геть з «Далі»).
function fixtureNow() {
  return [
    { kind: 'diet', title: 'Без молочного', from: iso(day(-4)), to: iso(day(16)), strict: true, source: 'user', id: 'diet1', rule_text: 'без молока, сирів, вершків' },
    { kind: 'season', title: 'Сливи', from: iso(day(-60)), to: iso(day(1)), strict: false, source: 'catalog', occasion_id: 'season-plum', meaning: 'сливи в пріоритеті' },
    { kind: 'season', title: 'Білі гриби', from: iso(day(-10)), to: iso(day(43)), strict: false, source: 'catalog', occasion_id: 'mushroom' },
  ];
}
function fixtureEvents() {
  return [
    { id: 'guests', scope: 'household', kind: 'custom', title: 'Гості на вечерю', start: day(0).getTime(), end: day(0, 23).getTime(), force: 'hint', servings: 6 },
    { id: 'notime', scope: 'household', kind: 'constraint', title: 'Мало часу', start: day(4).getTime(), end: day(4, 23).getTime(), force: 'hint' },
    { id: 'silpo', scope: 'household', kind: 'supply', title: 'Замовлення Сільпо', start: day(10).getTime(), end: day(10, 23).getTime(), force: 'hint' },
    { id: 'weight', scope: 'household', kind: 'diet', title: 'Набір ваги', start: day(11).getTime(), end: day(41, 23).getTime(), force: 'hint', rule_text: 'калорійніше' },
    { id: 'diet1', scope: 'household', kind: 'diet', title: 'Без молочного', start: day(-4).getTime(), end: day(16, 23).getTime(), force: 'restrict', strict: true, rule_text: 'без молока, сирів, вершків' },
    { id: 'pokrova', scope: 'catalog', kind: 'tradition', title: 'Покрова', start: day(25).getTime(), end: day(25, 23).getTime(), force: 'hint' },
    { id: 'fast', scope: 'catalog', kind: 'tradition', title: 'Різдвяний піст', start: day(70).getTime(), end: day(109, 23).getTime(), force: 'restrict', restricts: 'без мʼяса, риби, молочного і яєць' },
    { id: 'season-plum', scope: 'catalog', kind: 'season', title: 'Сливи', start: day(-60).getTime(), end: day(1, 23).getTime(), force: 'hint' },
  ];
}

async function mount(wide: boolean, now: unknown[], events: unknown[]) {
  vi.stubGlobal('matchMedia', vi.fn((q: string) => ({ matches: wide && q.includes('768'), addEventListener: () => {}, removeEventListener: () => {} })));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/v1/now')) return jsonRes({ now });
    if (url.includes('/v1/events')) return jsonRes({ events });
    return jsonRes({});
  }));
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter><CalendarPage /></MemoryRouter>); });
  await act(async () => {});
  return { host, root };
}

describe('CalendarPage · «Сьогодні»', () => {
  let host: HTMLDivElement | undefined; let root: Root | undefined;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(FIXED_NOW)); });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('число, «субота · сьогодні», порядок: строгий період → подія дня → сезон одним рядком', async () => {
    ({ host, root } = await mount(true, fixtureNow(), fixtureEvents()));
    const card = host!.querySelector('[data-cal-today]')!;
    expect(card.querySelector('[class*="_today-num_"]')!.textContent).toBe('19');
    expect(card.textContent).toContain('субота');
    expect(card.textContent).toContain('сьогодні');
    expect(card.textContent).toContain('Без молочного');
    expect(card.textContent).toContain('5-й день з 21');
    expect(card.textContent).toContain('Гості на вечерю');
    expect(card.textContent).toContain('6 осіб');
    // Обмеження — по тапу, не в картці.
    expect(card.textContent).not.toContain('без молока, сирів, вершків');
    // Сезони — одним рядком «Сезон: …», не поіменно кожен.
    expect(card.textContent).toContain('Сезон: Сливи (до 20.09), Білі гриби');
    const rows = [...card.querySelectorAll('[class*="_today-row_"]')].map((r) => r.textContent);
    const idx = (s: string) => rows.findIndex((r) => r?.includes(s));
    expect(idx('Без молочного')).toBeLessThan(idx('Гості на вечерю'));
    expect(idx('Гості на вечерю')).toBeLessThan(idx('Сезон:'));
  });

  it('розкриття «Сезон» — список сезонів рядками «назва · до дати»', async () => {
    ({ host, root } = await mount(true, fixtureNow(), fixtureEvents()));
    const toggle = host!.querySelector<HTMLButtonElement>('[data-cal-season-toggle]')!;
    expect(host!.textContent).not.toContain('Білі гриби · ');
    await act(async () => { toggle.click(); });
    const card = host!.querySelector('[data-cal-today]')!;
    expect(card.textContent).toContain('Сливи');
    expect(card.textContent).toContain('до 20.09');
    expect(card.textContent).toContain('Білі гриби');
  });

  it('порожньо — «Нічого не діє»', async () => {
    ({ host, root } = await mount(true, [], []));
    expect(host!.querySelector('[data-cal-today-empty]')!.textContent).toBe('Нічого не діє');
  });
});

describe('CalendarPage · «Далі»', () => {
  let host: HTMLDivElement | undefined; let root: Root | undefined;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(FIXED_NOW)); });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('сезони геть повністю; сьогоднішнє геть; одноденні й старт власного періоду — з датами', async () => {
    ({ host, root } = await mount(true, [], fixtureEvents()));
    const ahead = host!.querySelector('[data-cal-ahead]')!;
    expect(ahead.textContent).not.toContain('Сливи');
    expect(ahead.textContent).not.toContain('Гості на вечерю');
    expect(ahead.textContent).toContain('Мало часу');
    expect(ahead.textContent).toContain('рамка дня');
    expect(ahead.textContent).toContain('Замовлення Сільпо');
    expect(ahead.textContent).toContain('постачання');
    expect(ahead.textContent).toContain('Набір ваги');
    expect(ahead.textContent).toContain('до 30.10 · 31 день · калорійніше');
  });

  it('рядок-кінець для власного періоду, що вже діє («Без молочного» → 05.10 · кінець)', async () => {
    ({ host, root } = await mount(true, [], fixtureEvents()));
    const ahead = host!.querySelector('[data-cal-ahead]')!;
    const rows = [...ahead.querySelectorAll('[class*="_li_"]')].map((r) => r.textContent ?? '');
    expect(rows.some((r) => r.includes('Без молочного') && r.includes('кінець'))).toBe(true);
  });

  it('власний період, що СТАРТУЄ в горизонті («Набір ваги»), дає ОБИДВА рядки — старт і кінець', async () => {
    ({ host, root } = await mount(true, [], fixtureEvents()));
    const ahead = host!.querySelector('[data-cal-ahead]')!;
    const weight = [...ahead.querySelectorAll('[class*="_li_"]')].filter((r) => r.textContent?.includes('Набір ваги'));
    expect(weight.length).toBe(2);
    expect(weight.some((r) => r.textContent?.includes('кінець'))).toBe(true);
    expect(weight.some((r) => r.textContent?.includes('31 день'))).toBe(true);
  });

  it('каталожний тривалий (піст) — лише рядок-старт із повною метою, без окремого «кінець»', async () => {
    ({ host, root } = await mount(true, [], fixtureEvents()));
    const ahead = host!.querySelector('[data-cal-ahead]')!;
    const fast = [...ahead.querySelectorAll('[class*="_li_"]')].filter((r) => r.textContent?.includes('Різдвяний піст'));
    expect(fast.length).toBe(1);
    expect(fast[0]!.textContent).toContain('до 06.01 · 40 днів · без мʼяса, риби, молочного і яєць');
  });

  it('роздільники місяців — «Жовтень», «Листопад»; для вересня роздільника нема', async () => {
    ({ host, root } = await mount(true, [], fixtureEvents()));
    const ahead = host!.querySelector('[data-cal-ahead]')!;
    const mons = [...ahead.querySelectorAll('[class*="_mon_"]')].map((m) => m.textContent);
    expect(mons).toEqual(['Жовтень', 'Листопад']);
    expect(host!.textContent).not.toContain('Вересень');
  });

  it('порожній список при непорожньому «Сьогодні» — блок «Далі» не рендериться', async () => {
    ({ host, root } = await mount(true, fixtureNow(), []));
    expect(host!.querySelector('[data-cal-ahead]')).toBeNull();
    expect(host!.querySelector('[data-cal-empty]')).toBeNull();
  });
});

describe('CalendarPage · кнопки й порожній стан', () => {
  let host: HTMLDivElement | undefined; let root: Root | undefined;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(FIXED_NOW)); });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('≥768: кнопки в шапці, повний текст «Своя подія»; панелі під списком нема', async () => {
    ({ host, root } = await mount(true, [], fixtureEvents()));
    expect(host!.querySelector('[data-cal-catalog]')).not.toBeNull();
    expect(host!.querySelector('[data-cal-add]')!.textContent).toContain('Своя подія');
    expect(host!.querySelector('[data-cal-btn-row]')).toBeNull();
  });

  it('<768: кнопок у шапці нема, панель під списком на всю ширину, повні підписи', async () => {
    ({ host, root } = await mount(false, [], fixtureEvents()));
    const header = host!.querySelector('header')!;
    expect(header.querySelector('[data-cal-catalog]')).toBeNull();
    const row = host!.querySelector('[data-cal-btn-row]')!;
    expect(row).not.toBeNull();
    expect(row.querySelector('[data-cal-catalog]')).not.toBeNull();
    expect(row.querySelector('[data-cal-add]')!.textContent).toContain('Своя подія');
  });

  it('порожній стан: «Сьогодні» з «Нічого не діє» + пунктирний блок з реченням і кнопками', async () => {
    ({ host, root } = await mount(true, [], []));
    expect(host!.querySelector('[data-cal-today-empty]')).not.toBeNull();
    const empty = host!.querySelector('[data-cal-empty]')!;
    expect(empty.textContent).toContain('тут буде видно, що попереду');
    expect(empty.querySelector('[data-cal-catalog]')).not.toBeNull();
    expect(empty.querySelector('[data-cal-add]')).not.toBeNull();
  });

  it('порожній стан на <768 — панель під списком НЕ дублюється (кнопки лише в блоці)', async () => {
    ({ host, root } = await mount(false, [], []));
    expect(host!.querySelector('[data-cal-btn-row]')).toBeNull();
    expect(host!.querySelector('[data-cal-empty]')).not.toBeNull();
  });
});

// Хотфікс 13.09 (баг власника на проді): після «Каталогу» клік по події не
// перемикав панель — два стани (openEvent + openSeries), ефект брав серію
// пріоритетно. Тепер «що відкрито» — один стан: подія або серія (2b: каталог).
describe('панель: подія ↔ каталог — одне з двох', () => {
  let root: Root | undefined; let host: HTMLDivElement | undefined;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(FIXED_NOW)); usePanelStore.getState().clear(); });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLButtonElement).click(); }); await act(async () => {}); };
  const eventButton = () => [...host!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Мало часу')) ?? null;

  // wide: і кнопки шапки (≥768), і панель у потоці (≥1200) — тут matchMedia
  // не звіряє рядок запиту, обидва мають збігтись при wide.
  async function mountPanel(wide: boolean, events: unknown[]) {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: wide, addEventListener: () => {}, removeEventListener: () => {} })));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/v1/now')) return jsonRes({ now: [] });
      if (url.includes('/v1/events')) return jsonRes({ events });
      return jsonRes({});
    }));
    const h = document.createElement('div'); document.body.appendChild(h); const r = createRoot(h);
    await act(async () => { r.render(<MemoryRouter><CalendarPage /></MemoryRouter>); });
    await act(async () => {});
    return { host: h, root: r };
  }

  it('≥1200 (панель): Каталог → клік по події → панель «Подія»; подія → Каталог → «Каталог подій»', async () => {
    ({ host, root } = await mountPanel(true, fixtureEvents()));
    await click(host!.querySelector('[data-cal-catalog]'));
    expect(usePanelStore.getState().artifacts.map((a) => a.label)).toEqual(['Каталог подій']);
    await click(eventButton());
    const st = usePanelStore.getState();
    expect(st.artifacts.map((a) => a.label)).toEqual(['Подія']);
    expect(st.active).toBe('event:notime');
    await click(host!.querySelector('[data-cal-catalog]'));
    expect(usePanelStore.getState().artifacts.map((a) => a.label)).toEqual(['Каталог подій']);
    expect(usePanelStore.getState().active).toBe('catalog');
  }, 15_000);

  it('<600 (шторка): Каталог → клік по події → шторка події, не каталогу', async () => {
    ({ host, root } = await mountPanel(false, fixtureEvents()));
    await click(host!.querySelector('[data-cal-catalog]'));
    expect(host!.textContent).toContain('Каталог подій');
    await click(eventButton());
    const sheets = [...host!.querySelectorAll('[data-sheet]')].map((e) => e.getAttribute('aria-label'));
    expect(sheets).toContain('Мало часу');
    expect(sheets).not.toContain('Каталог подій');
  });

  it('«Своя подія» відкриває шторку створення напряму, каталог не чіпає', async () => {
    ({ host, root } = await mountPanel(true, fixtureEvents()));
    await click(host!.querySelector('[data-cal-add]'));
    const sheets = [...host!.querySelectorAll('[data-sheet]')].map((e) => e.getAttribute('aria-label'));
    expect(sheets).toContain('Нова подія');
    expect(usePanelStore.getState().artifacts).toEqual([]);
    expect(host!.textContent).not.toContain('Каталог подій');
  });

  it('«+ Своя подія» лишала каталог відкритим позаду — закриває панель перед відкриттям шторки', async () => {
    ({ host, root } = await mountPanel(true, fixtureEvents()));
    await click(host!.querySelector('[data-cal-catalog]'));
    expect(usePanelStore.getState().active).toBe('catalog');
    await click(host!.querySelector('[data-cal-add]'));
    expect(usePanelStore.getState().artifacts).toEqual([]);
    const sheets = [...host!.querySelectorAll('[data-sheet]')].map((e) => e.getAttribute('aria-label'));
    expect(sheets).toContain('Нова подія');
  });

  // Уточнення ГОЛОВНИЙ ЧАТ 18.09 (К2): той самий occasion_id з «Сьогодні» і
  // з «Далі» відкриває той самий артефакт.
  it('той самий occasion_id з «Сьогодні» і з «Далі» відкриває той самий артефакт', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/v1/now')) return jsonRes({ now: fixtureNow() });
      if (url.includes('/v1/events')) return jsonRes({ events: fixtureEvents() });
      return jsonRes({});
    }));
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<MemoryRouter><CalendarPage /></MemoryRouter>); });
    await act(async () => {});
    const fromToday = [...host!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.className.includes('_today-row_') && b.textContent?.includes('Без молочного'))!;
    await act(async () => { fromToday.click(); });
    await act(async () => {});
    expect(usePanelStore.getState().active).toBe('event:diet1');
    const fromAhead = [...host!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.className.includes('_li_') && b.textContent?.includes('Без молочного'))!;
    await act(async () => { fromAhead.click(); });
    await act(async () => {});
    expect(usePanelStore.getState().active).toBe('event:diet1');
  });
});
