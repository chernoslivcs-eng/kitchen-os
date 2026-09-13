// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { CalendarPage } from './Calendar';
import { CALENDAR_FAILED } from '../../components/ErrorState/copy';
import { usePanelStore } from '../../store/panel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Етап 5 (п.2): не принести ≠ «нічого не триває». Дні в календарі є завжди,
// тому без тосту збій читався б як спокійний тиждень.

describe('CalendarPage · збій завантаження', () => {
  let host: HTMLDivElement | undefined; let root: Root | undefined;
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); });

  it('500 на /v1/events → тост із повтором; повтор приносить події й знімає тост', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })));
    let eventsStatus = 500;
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/v1/events')) return eventsStatus === 200 ? json({ events: [] }) : json({ error: 'boom' }, 500);
      if (url.includes('/v1/occasions/subscriptions')) return json({ subscriptions: [] });
      return json({});
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

// Крок 1 (v3, Screens D3): на ≥1024 — тижні картками по 7 колонок, тривале
// смугами над днями з підписом лише в першому тижні; нижче — стрічка днів з
// рисками в жолобі й підписом-чіпом у день початку. Одна подія — в одній осі.
describe('CalendarPage · дві осі в двох розкладках', () => {
  let host: HTMLDivElement | undefined; let root: Root | undefined;
  // Аудит 0913 C.8: фікстура будувалась від реального new Date() — «завтра» в
  // неділю вже наступний тиждень, і «Цього тижня» порожніло. Час — середа.
  // CAL_TEST_NOW — лише для ручного прогону на інших днях тижня.
  const FIXED_NOW = process.env.CAL_TEST_NOW ?? '2026-09-16T10:00:00';
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(FIXED_NOW)); });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const day = (offset: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; };
  const events = () => [
    { id: 'fast', scope: 'catalog', kind: 'tradition', title: 'Великий піст', start: day(-3).getTime(), end: day(20).getTime(), force: 'restrict', strict: true, from: iso(day(-3)), to: iso(day(20)) },
    { id: 'guests', scope: 'household', kind: 'custom', title: 'Мама приїжджає', start: day(1).getTime(), end: day(1).getTime(), force: 'hint', from: iso(day(1)), to: iso(day(1)) },
  ];
  async function mount(wide: boolean) {
    vi.stubGlobal('matchMedia', vi.fn((q: string) => ({ matches: wide && q.includes('1024'), addEventListener: () => {}, removeEventListener: () => {} })));
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/v1/events')) return json({ events: events() });
      if (url.includes('/v1/occasions/subscriptions')) return json({ subscriptions: [] });
      return json({});
    }));
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<MemoryRouter><CalendarPage /></MemoryRouter>); });
    await act(async () => {});
  }

  // №25 (6c): ≥1024 — місяць сіткою; тижні D3a — вид «Тиждень»; стрічка — «Список».
  it('≥1024: місяць сіткою — смуга посту над датами (не в клітинці), точкова в клітинці, сьогодні колом; права колонка: сьогодні · цього тижня · триває', async () => {
    localStorage.removeItem('kos-cal-view');
    await mount(true);
    expect(host!.querySelector('[data-month-grid]')).not.toBeNull();
    const bars = [...host!.querySelectorAll('[class*="_mbar_"]')];
    expect(bars.some((b) => b.getAttribute('aria-label') === 'Великий піст')).toBe(true);
    const cells = [...host!.querySelectorAll('[class*="_mcell_"]')].map((c) => c.textContent ?? '');
    expect(cells.some((t) => t.includes('Мама приїжджає'))).toBe(true);
    expect(cells.some((t) => t.includes('Великий піст'))).toBe(false);
    expect(host!.querySelector('[class*="mcell-today"]')).not.toBeNull();
    expect(host!.querySelector('[data-cal-today]')!.textContent).toContain('сьогодні');
    expect(host!.querySelector('[data-cal-week]')!.textContent).toContain('Мама приїжджає');
    expect(host!.querySelector('[data-cal-running]')!.textContent).toContain('Великий піст');
    expect(host!.querySelector('[data-cal-ask]')!.textContent).toContain('Що на вечерю завтра?');
    expect(host!.querySelector('[data-subscriptions]')).not.toBeNull();
  });

  // Зафіксована поведінка продукту: «Цього тижня» — до неділі включно; у
  // неділю завтрашня подія вже належить наступному тижню й у колонці не стоїть.
  it('≥1024, неділя: подія «завтра» не потрапляє в «Цього тижня»', async () => {
    vi.setSystemTime(new Date('2026-09-13T10:00:00'));
    localStorage.removeItem('kos-cal-view');
    await mount(true);
    expect(host!.querySelector('[data-cal-week]')!.textContent).not.toContain('Мама приїжджає');
    expect(host!.querySelector('[data-cal-week]')!.textContent).toContain('Нічого не заплановано.');
  });

  it('≥1024: «Тиждень» — картка тижня D3a з підписом «день N з M»; «Список» — стрічка днів; вид памʼятається', async () => {
    localStorage.removeItem('kos-cal-view');
    await mount(true);
    await act(async () => { host!.querySelector<HTMLButtonElement>('[data-view="week"]')!.click(); });
    expect(host!.querySelectorAll('[class*="week-cap"]').length).toBe(1);
    const bars = [...host!.querySelectorAll('[class*="_bar_"]')].map((b) => b.textContent);
    expect(bars.filter((t) => t?.startsWith('Великий піст · день')).length).toBe(1);
    expect(localStorage.getItem('kos-cal-view')).toBe('week');
    await act(async () => { host!.querySelector<HTMLButtonElement>('[data-view="list"]')!.click(); });
    expect(host!.querySelectorAll('[class*="_rail_"]').length).toBeGreaterThan(0);
    expect(host!.querySelector('[data-month-grid]')).toBeNull();
  });

  // FIXES-V3-2 №26: вхід до підписок — у шапці календаря, не лише внизу стрічки.
  it('№26: «Підписки» у шапці є й відкриває картку підписок (шторкою нижче 1200)', async () => {
    await mount(false);
    const btn = host!.querySelector<HTMLButtonElement>('[data-subscriptions]');
    expect(btn).not.toBeNull();
    await act(async () => { btn!.click(); });
    await act(async () => {});
    expect(host!.textContent).toContain('Що впливає на кухню');
  });

  it('<1024: рядки днів з риской у жолобі, чіп лише в день початку, без заголовків тижнів', async () => {
    await mount(false);
    expect(host!.querySelector('[class*="_cell_"]')).toBeNull();
    expect(host!.querySelectorAll('[class*="_rail_"]').length).toBe(24);
    const tags = [...host!.querySelectorAll('[class*="_tag_"]')].map((t) => t.textContent);
    expect(tags.filter((t) => t?.startsWith('Великий піст')).length).toBe(2); // початок і кінець
    expect(host!.querySelector('[class*="monthbar"]')?.textContent).toMatch(/тиждень \d+ · \d+ – \d+/);
    expect(host!.textContent).not.toMatch(/ТРИВАЄ/);
  });
});

// Хотфікс 13.09 (баг власника на проді): після «Підписок» клік по події не
// перемикав панель — два стани (openEvent + openSeries), ефект брав серію
// пріоритетно. Тепер «що відкрито» — один стан: подія або серія.
describe('панель: подія ↔ підписки — одне з двох', () => {
  let root: Root | undefined; let host: HTMLDivElement | undefined;
  const FIXED_NOW = '2026-09-16T10:00:00';
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(FIXED_NOW)); usePanelStore.getState().clear(); });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const day = (offset: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; };
  const events = () => [
    { id: 'fast', scope: 'catalog', kind: 'tradition', title: 'Великий піст', start: day(-3).getTime(), end: day(20).getTime(), force: 'restrict', strict: true, from: iso(day(-3)), to: iso(day(20)) },
    { id: 'guests', scope: 'household', kind: 'custom', title: 'Мама приїжджає', start: day(1).getTime(), end: day(1).getTime(), force: 'hint', from: iso(day(1)), to: iso(day(1)) },
  ];
  // wide: і сітка (≥1024), і панель у потоці (≥600); narrow — ні те, ні те (шторка).
  async function mount(wide: boolean) {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: wide, addEventListener: () => {}, removeEventListener: () => {} })));
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/v1/events')) return json({ events: events() });
      if (url.includes('/v1/occasions/subscriptions')) return json({ subscriptions: [] });
      return json({});
    }));
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<MemoryRouter><CalendarPage /></MemoryRouter>); });
    await act(async () => {});
  }
  const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLButtonElement).click(); }); await act(async () => {}); };
  const eventButton = () => [...host!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Мама приїжджає')) ?? null;

  it('≥1200 (панель): Підписки → клік по події → панель «Подія» з назвою; подія → Підписки → «Підписки»', async () => {
    await mount(true);
    await click(host!.querySelector('[data-subscriptions]'));
    expect(usePanelStore.getState().artifacts.map((a) => a.label)).toEqual(['Підписки']);
    await click(eventButton());
    const st = usePanelStore.getState();
    expect(st.artifacts.map((a) => a.label)).toEqual(['Подія']);
    expect(st.active).toBe('event:guests');
    await click(host!.querySelector('[data-subscriptions]'));
    expect(usePanelStore.getState().artifacts.map((a) => a.label)).toEqual(['Підписки']);
    expect(usePanelStore.getState().active).toBe('subscriptions');
  });

  // Р145 (рішення власника 13.09): у картці «Триває» — кнопка «Каталог подій» (як
  // «Що на вечерю завтра?») замість рядка «Приховані сезони · N · Свята: …»;
  // «N приховано» під нею — лише при N > 0.
  it('≥1024: у «Триває» — кнопка «Каталог подій» (aria «Усі підписки»), без переліку конфесій; «N приховано» лише коли є приховані', async () => {
    await mount(true);
    const card = host!.querySelector('[data-subscriptions][aria-label="Усі підписки"]')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toBe('Каталог подій');
    expect(card.querySelector('[data-icon]')).not.toBeNull();
    expect(host!.textContent).not.toContain('Приховані сезони');
    expect(host!.textContent).not.toContain('Свята:');
    expect(host!.querySelector('[data-hidden-count]')).toBeNull();
    await click(card);
    expect(usePanelStore.getState().artifacts.map((a) => a.label)).toEqual(['Підписки']);
  });

  it('≥1024: два приховані сезони → «2 приховано» поруч із кнопкою', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })));
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/v1/events')) return json({ events: events() });
      if (url.includes('/v1/occasions/subscriptions')) return json({ subscriptions: [
        { occasion_id: 's1', enabled: false, type: 'season', tradition: null, title: 'Кавуни', updated_at: '' },
        { occasion_id: 's2', enabled: false, type: 'season', tradition: null, title: 'Гриби', updated_at: '' },
        { occasion_id: 't1', enabled: false, type: 'tradition', tradition: 'orthodox', title: 'Православні', updated_at: '' },
      ] });
      return json({});
    }));
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<MemoryRouter><CalendarPage /></MemoryRouter>); });
    await act(async () => {});
    expect(host!.querySelector('[data-hidden-count]')!.textContent).toBe('2 приховано');
  });

  it('<600 (шторка): Підписки → клік по події → шторка події, не підписок', async () => {
    await mount(false);
    await click(host!.querySelector('[data-subscriptions]'));
    expect(host!.textContent).toContain('Що впливає на кухню');
    await click(eventButton());
    const sheets = [...host!.querySelectorAll('[data-sheet]')].map((e) => e.getAttribute('aria-label'));
    expect(sheets).toContain('Мама приїжджає');
    expect(sheets).not.toContain('Підписки');
    expect(host!.textContent).not.toContain('Що впливає на кухню');
  });
});
