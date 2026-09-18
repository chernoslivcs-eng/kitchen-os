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

// Спек 18.09 (2b): сьогодні пʼт 18.09.2026 — ті самі числа, що в agenda.test.ts
// і в наповненні макета («4-й день з 21», «21.09 пн», «31 день»).
const FIXED_NOW = '2026-09-18T10:00:00';
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (offset: number, h = 0) => { const d = new Date(2026, 8, 18, h); d.setDate(d.getDate() + offset); return d; };

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

// Наповнення 2b (К8, 18.09 вечір; уточнено ГОЛОВНИЙ ЧАТ після живих даних
// на стенді): «Без молочного» — своя дієта, вже діє; Сливи — сезон, добігає;
// «Гості на вечерю» 19.09 — kind 'meal' (запланована вечеря дому, як у
// реальному наповненні!), одноденна попереду; Набір ваги — тривала попереду;
// «Панкейки» — теж kind 'meal', але СЬОГОДНІ: не попереду (це «зараз», не
// «готування в процесі» — те окреме поняття живе в cook-session, geть з
// календаря взагалі, тут не фігурує).
function fixtureNow() {
  return [
    { kind: 'diet', title: 'Без молочного', from: iso(day(-3)), to: iso(day(17)), strict: true, source: 'user', id: 'diet1', rule_text: 'без молока, сирів, вершків' },
    { kind: 'season', title: 'Сливи', from: iso(day(-60)), to: iso(day(3)), strict: false, source: 'catalog', occasion_id: 'plum', meaning: 'сливи в пріоритеті' },
  ];
}
function fixtureEvents() {
  return [
    { id: 'diet1', scope: 'household', kind: 'diet', title: 'Без молочного', start: day(-3).getTime(), end: day(17, 23).getTime(), force: 'restrict', strict: true, from: iso(day(-3)), to: iso(day(17)), rule_text: 'без молока, сирів, вершків' },
    { id: 'plum', scope: 'catalog', kind: 'season', title: 'Сливи', start: day(-60).getTime(), end: day(3, 23).getTime(), force: 'hint', from: iso(day(-60)), to: iso(day(3)) },
    { id: 'guests', scope: 'household', kind: 'meal', title: 'Гості на вечерю', start: day(1).getTime(), end: day(1, 23).getTime(), force: 'hint', servings: 6 },
    { id: 'weight', scope: 'household', kind: 'diet', title: 'Набір ваги', start: day(12).getTime(), end: day(42, 23).getTime(), force: 'hint', from: iso(day(12)), to: iso(day(42)) },
    { id: 'pancakes', scope: 'household', kind: 'meal', title: 'Панкейки', start: day(0).getTime(), end: day(0, 23).getTime(), force: 'hint' },
  ];
}

async function mount(wide: boolean, now: unknown[], events: unknown[]) {
  vi.stubGlobal('matchMedia', vi.fn((q: string) => ({ matches: wide && q.includes('1024'), addEventListener: () => {}, removeEventListener: () => {} })));
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

describe('CalendarPage · «Зараз діє»', () => {
  let host: HTMLDivElement | undefined; let root: Root | undefined;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(FIXED_NOW)); });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('своя дієта — прогрес і день/загалом; сезон з каталогу — «до дати» й значення, без прогресу', async () => {
    ({ host, root } = await mount(true, fixtureNow(), fixtureEvents()));
    const nowCard = host!.querySelector('[data-cal-now]')!;
    expect(nowCard.textContent).toContain('Без молочного');
    expect(nowCard.textContent).toContain('4-й день з 21');
    expect(nowCard.textContent).toContain('без молока, сирів, вершків');
    expect(nowCard.querySelector('[class*="now-progress"]')).not.toBeNull();
    expect(nowCard.textContent).toContain('Сливи');
    expect(nowCard.textContent).toContain('до 21.09');
    expect(nowCard.textContent).toContain('сливи в пріоритеті');
  });

  it('понад 4 — «Показати всі», решта ховається до кліку', async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({
      kind: 'season', title: `Сезон ${i}`, from: iso(day(-10)), to: iso(day(10)), strict: false, source: 'catalog', occasion_id: `s${i}`,
    }));
    ({ host, root } = await mount(true, five, []));
    expect(host!.textContent).toContain('Показати всі · 5');
    expect(host!.textContent).not.toContain('Сезон 4');
    const btn = [...host!.querySelectorAll('button')].find((b) => b.textContent?.includes('Показати всі'))!;
    await act(async () => { btn.click(); });
    expect(host!.textContent).toContain('Сезон 4');
  });
});

describe('CalendarPage · «Попереду»', () => {
  let host: HTMLDivElement | undefined; let root: Root | undefined;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(FIXED_NOW)); });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('kind meal у майбутньому (вечеря дому) — показується; те саме сьогодні — ні (не «готування в процесі», просто «зараз», не «попереду»)', async () => {
    ({ host, root } = await mount(true, [], fixtureEvents()));
    const ahead = host!.querySelector('[data-cal-ahead]')!;
    expect(ahead.textContent).not.toContain('Панкейки');
    expect(ahead.textContent).toContain('Гості на вечерю');
    expect(ahead.textContent).toContain('19.09');
    expect(ahead.textContent).toContain('6 осіб');
    expect(ahead.textContent).toContain('Набір ваги');
    expect(ahead.textContent).toContain('30.09 – 30.10 · 31 день');
  });

  it('те, що вже триває й добігає в горизонті — рядком «останні дні»', async () => {
    ({ host, root } = await mount(true, [], fixtureEvents()));
    const ahead = host!.querySelector('[data-cal-ahead]')!;
    expect(ahead.textContent).toContain('Сливи');
    expect(ahead.textContent).toContain('21.09');
    expect(ahead.textContent).toContain('останні дні');
  });

  it('«Показати далі» розширює горизонт — подія за першим горизонтом стає видною', async () => {
    const farAway = { id: 'far', scope: 'household', kind: 'custom', title: 'Далека подія', start: day(80).getTime(), end: day(80, 23).getTime(), force: 'hint' };
    ({ host, root } = await mount(true, [], [...fixtureEvents(), farAway]));
    expect(host!.textContent).not.toContain('Далека подія');
    const more = host!.querySelector<HTMLButtonElement>('[data-cal-ahead-more]')!;
    await act(async () => { more.click(); });
    await act(async () => {});
    await act(async () => { more.click(); });
    await act(async () => {});
    expect(host!.textContent).toContain('Далека подія');
  });
});

describe('CalendarPage · порожній стан і сітка-довідка', () => {
  let host: HTMLDivElement | undefined; let root: Root | undefined;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(FIXED_NOW)); });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('нема ні «зараз», ні «попереду» — одна кнопка «Обрати події» (К1), без заголовків карток', async () => {
    ({ host, root } = await mount(true, [], []));
    expect(host!.querySelector('[data-cal-empty]')).not.toBeNull();
    expect(host!.textContent).toContain('Обрати події');
    expect(host!.querySelector('[data-cal-now]')).toBeNull();
    expect(host!.querySelector('[data-cal-ahead]')).toBeNull();
  });

  it('≥1024: сітка згорнута за замовчуванням; розкриття показує поточний місяць, доріжка тримається через тижні', async () => {
    const spanning = { id: 'fast', scope: 'catalog', kind: 'tradition', title: 'Піст', start: day(-3).getTime(), end: day(20, 23).getTime(), force: 'restrict', strict: true, from: iso(day(-3)), to: iso(day(20)) };
    ({ host, root } = await mount(true, [], [spanning]));
    expect(host!.querySelector('[data-cal-grid-toggle]')).not.toBeNull();
    expect(host!.querySelector('[data-month-grid]')).toBeNull();
    expect(host!.textContent).toContain('Сітка вересня — якщо треба глянути дати');
    const toggle = host!.querySelector<HTMLButtonElement>('[data-cal-grid-toggle]')!;
    await act(async () => { toggle.click(); });
    expect(host!.querySelector('[data-month-grid]')).not.toBeNull();
    const bars = [...host!.querySelectorAll('[class*="_mbar_"][aria-label="Піст"]')];
    expect(bars.length).toBeGreaterThanOrEqual(1);
  });

  it('<1024: сітки нема зовсім (К4)', async () => {
    ({ host, root } = await mount(false, [], fixtureEvents()));
    expect(host!.querySelector('[data-cal-grid-toggle]')).toBeNull();
    expect(host!.querySelector('[data-month-grid]')).toBeNull();
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
  const eventButton = () => [...host!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Гості')) ?? null;

  // wide: і сітка (≥1024), і панель у потоці (≥1200) — на відміну від спільного
  // mount(), тут matchMedia не звіряє рядок запиту: панель і сітка — різні
  // breakpoints (ARTIFACT_SIDE ≠ 1024), і обидва мають збігтись при wide.
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

  it('≥1200 (панель): Додати → клік по події → панель «Подія»; подія → Додати → «Каталог подій»', async () => {
    ({ host, root } = await mountPanel(true, fixtureEvents()));
    await click(host!.querySelector('[data-cal-add]'));
    expect(usePanelStore.getState().artifacts.map((a) => a.label)).toEqual(['Каталог подій']);
    await click(eventButton());
    const st = usePanelStore.getState();
    expect(st.artifacts.map((a) => a.label)).toEqual(['Подія']);
    expect(st.active).toBe('event:guests');
    await click(host!.querySelector('[data-cal-add]'));
    expect(usePanelStore.getState().artifacts.map((a) => a.label)).toEqual(['Каталог подій']);
    expect(usePanelStore.getState().active).toBe('catalog');
  }, 15_000);

  it('<600 (шторка): Додати → клік по події → шторка події, не каталогу', async () => {
    ({ host, root } = await mountPanel(false, fixtureEvents()));
    await click(host!.querySelector('[data-cal-add]'));
    expect(host!.textContent).toContain('Каталог подій');
    await click(eventButton());
    const sheets = [...host!.querySelectorAll('[data-sheet]')].map((e) => e.getAttribute('aria-label'));
    expect(sheets).toContain('Гості на вечерю');
    expect(sheets).not.toContain('Каталог подій');
  });
});
