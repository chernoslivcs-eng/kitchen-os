// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { CalendarPage } from './Calendar';
import { CALENDAR_FAILED } from '../../components/ErrorState/copy';

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
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); });

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

  it('≥1024: картки тижнів, смуга посту в рядку смуг (не в клітинці), підпис «день N з M» лише раз', async () => {
    await mount(true);
    const weeks = host!.querySelectorAll('[class*="week-cap"]');
    expect(weeks.length).toBeGreaterThan(50);
    const bars = [...host!.querySelectorAll('[class*="_bar_"]')].map((b) => b.textContent);
    expect(bars.filter((t) => t?.startsWith('Великий піст · день')).length).toBe(1);
    expect(bars.filter((t) => t === 'Великий піст').length).toBeGreaterThan(1);
    // Точкова — в клітинці дня, тривала — ні.
    const cells = [...host!.querySelectorAll('[class*="_cell_"]')].map((c) => c.textContent ?? '');
    expect(cells.some((t) => t.includes('Мама приїжджає'))).toBe(true);
    expect(cells.some((t) => t.includes('Великий піст'))).toBe(false);
    expect(host!.querySelector('[class*="_rail_"]')).toBeNull();
    expect(host!.textContent).toContain('Що на вечерю?');
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
