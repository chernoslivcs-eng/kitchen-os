// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// 15.09: файл із монтуванням сторінки й кількома кліками на тест іде довго на
// раннері CI під --parallel; 5 с на тест давали флейк.
vi.setConfig({ testTimeout: 20_000 });
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CalendarPage } from './Calendar';
import { CALENDAR_FAILED } from '../../components/ErrorState/copy';
import { usePanelStore } from '../../store/panel';
import type { NowItem } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// К9 (рішення 19.09, «мінімум») + приведення до каркасу Комори: сьогодні
// субота 19.09.2026 — той самий день, що в calendar-minimal-0919.html.
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

// Приведення до Комори: кнопки шапки («Каталог»/«+ Своя подія») тепер
// завжди в AppHeader на всіх ширинах — `wide` тут лишається лише для
// панелі праворуч (ARTIFACT_SIDE ≥1200) через ту саму заглушку matchMedia.
async function mount(wide: boolean, now: unknown[], events: unknown[]) {
  vi.stubGlobal('matchMedia', vi.fn((q: string) => ({ matches: wide && q.includes('1200'), addEventListener: () => {}, removeEventListener: () => {} })));
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

describe('CalendarPage · шапка (приведення до Комори)', () => {
  let host: HTMLDivElement | undefined; let root: Root | undefined;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(FIXED_NOW)); });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('заголовок «Календар» без дати; лічильник «N діє · M попереду»; обидві кнопки завжди в шапці', async () => {
    ({ host, root } = await mount(true, fixtureNow(), fixtureEvents()));
    const header = host!.querySelector('header')!;
    expect(header.querySelector('h1')!.textContent).toBe('Календар');
    // діє: Без молочного + Гості на вечерю = 2 (сезони не рахуються окремо); попереду: рядки aheadRows.
    expect(header.textContent).toContain('2 діє');
    expect(header.querySelector('[data-cal-catalog]')).not.toBeNull();
    expect(header.querySelector('[data-cal-add]')).not.toBeNull();
    // Панелі під списком більше нема — кнопки лише в шапці.
    expect(host!.querySelector('[data-cal-btn-row]')).toBeNull();
  });

  it('порожньо — лічильник «нічого не діє»', async () => {
    ({ host, root } = await mount(true, [], []));
    const header = host!.querySelector('header')!;
    expect(header.textContent).toContain('нічого не діє');
  });
});

describe('CalendarPage · «Сьогодні» (zone-card)', () => {
  let host: HTMLDivElement | undefined; let root: Root | undefined;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(FIXED_NOW)); });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('section-label «Сьогодні» без лічильника; дата великим числом; порядок рядків', async () => {
    ({ host, root } = await mount(true, fixtureNow(), fixtureEvents()));
    const card = host!.querySelector('[data-cal-today]')!;
    expect(card.querySelector('[class*="_section-name_"]')!.textContent).toBe('Сьогодні');
    expect(card.querySelector('[class*="_section-count_"]')).toBeNull();
    // Живий стенд 20.09: дата не дублюється — «19 вересня» крупно одним
    // рядком, «сб» коротким днем тижня поруч (не «19» окремо + «субота · 19 вересня»).
    expect(card.querySelector('[class*="_today-num_"]')!.textContent).toBe('19 вересня');
    expect(card.querySelector('[class*="_today-sub_"]')!.textContent).toBe('сб');
    expect(card.textContent).not.toContain('субота');
    expect(card.textContent).toContain('Без молочного');
    expect(card.textContent).toContain('5-й день з 21');
    expect(card.textContent).toContain('Гості на вечерю');
    expect(card.textContent).toContain('6 осіб');
    // Рішення власника 20.09: мета рядка «Сьогодні» — наслідок для кухні
    // (todayConsequence), тепер видима в картці, не лише по тапу.
    expect(card.textContent).toContain('без молока, сирів, вершків');
    // Сезони — назва «Сезон», зведення (без дат) другим рядком-метою.
    expect(card.textContent).toContain('СезонСливи · Білі гриби');
    const rows = [...card.querySelectorAll('[class*="_row_"]')].map((r) => r.textContent);
    const idx = (s: string) => rows.findIndex((r) => r?.includes(s));
    expect(idx('Без молочного')).toBeLessThan(idx('Гості на вечерю'));
    expect(idx('Гості на вечерю')).toBeLessThan(idx('Сезон'));
  });

  it('живий стенд 20.09: період окремою колонкою («15.09 – 05.10»), «дні» — ink; одноденна («Гості») — період порожній', async () => {
    ({ host, root } = await mount(true, fixtureNow(), fixtureEvents()));
    const card = host!.querySelector('[data-cal-today]')!;
    const rows = [...card.querySelectorAll('button[class*="_row_"]')];
    const diet1 = rows.find((r) => r.textContent?.includes('Без молочного'))!;
    expect(diet1.querySelector('[class*="_period_"]')!.textContent).toBe('15.09 – 05.10');
    const diet1Rval = diet1.querySelector('[class*="_rval_"]')!;
    expect(diet1Rval.textContent).toBe('5-й день з 21');
    expect(diet1Rval.className).toMatch(/_rval-days_/);

    const guests = rows.find((r) => r.textContent?.includes('Гості на вечерю'))!;
    expect(guests.querySelector('[class*="_period_"]')!.textContent).toBe('');
    expect(guests.querySelector('[class*="_rval_"]')!.textContent).toBe('6 осіб');
  });

  it('розкриття «Сезон» — зведення без дат ховається, підрядки «назва · до дати» зʼявляються', async () => {
    ({ host, root } = await mount(true, fixtureNow(), fixtureEvents()));
    const toggle = host!.querySelector<HTMLButtonElement>('[data-cal-season-toggle]')!;
    expect(toggle.textContent).toBe('СезонСливи · Білі гриби');
    await act(async () => { toggle.click(); });
    expect(toggle.textContent).toBe('Сезон');
    const card = host!.querySelector('[data-cal-today]')!;
    expect(card.textContent).toContain('Сливи');
    expect(card.textContent).toContain('до 20.09');
    expect(card.textContent).toContain('Білі гриби');
  });

  it('рішення власника 20.09: мета рядка — наслідок для кухні, три роди (rule_text власний / restricts каталожний / meaning без правила)', async () => {
    const consequenceNow: NowItem[] = [
      { kind: 'diet', title: 'Без молочного', from: iso(day(-4)), to: iso(day(16)), strict: true, source: 'user', id: 'diet1', rule_text: 'без молока, сирів, вершків' },
      { kind: 'tradition', title: 'Різдвяний піст', from: iso(day(0)), to: iso(day(20)), strict: true, source: 'catalog', occasion_id: 'fast', rule_text: 'без мʼяса, риби, молочного і яєць' },
      { kind: 'tradition', title: 'Покрова', from: iso(day(-3)), to: iso(day(3)), strict: false, source: 'catalog', occasion_id: 'pokrova', meaning: 'покров Богородиці над домом і людьми' },
    ];
    ({ host, root } = await mount(true, consequenceNow, []));
    const card = host!.querySelector('[data-cal-today]')!;
    expect(card.textContent).toContain('без молока, сирів, вершків');
    expect(card.textContent).toContain('без мʼяса, риби, молочного і яєць');
    expect(card.textContent).toContain('покров Богородиці над домом і людьми');
    // Рядок з метою — 56 (data-meta-wide), не 48.
    const rows = [...card.querySelectorAll('button[class*="_row_"]')];
    for (const t of ['Без молочного', 'Різдвяний піст', 'Покрова']) {
      expect(rows.find((r) => r.textContent?.includes(t))!.hasAttribute('data-meta-wide'), t).toBe(true);
    }
  });

  it('живий стенд 20.09: довга мета (300 символів, «Йом Кіпур») не ламає рендер — рядок і сусідні колонки лишаються на місці', async () => {
    const long = 'Добовий піст. Ситна вечеря напередодні без солоного й гострого, після посту — легке розговіння без мʼяса, молочного, яєць, риби і алкоголю, поки організм звикає знову їсти після довгого дня без води й їжі. Добовий піст. Ситна вечеря напередодні без солоного й гострого, після посту — легке розговіння'.slice(0, 300);
    expect(long.length).toBe(300);
    const longNow: NowItem[] = [
      { kind: 'diet', title: 'Йом Кіпур', from: iso(day(-4)), to: iso(day(16)), strict: true, source: 'catalog', occasion_id: 'yk', rule_text: long },
    ];
    ({ host, root } = await mount(true, longNow, []));
    const card = host!.querySelector('[data-cal-today]')!;
    const row = card.querySelector('button[class*="_row_"]')!;
    // Мета видима повністю в DOM (jsdom не рендерить справжній ellipsis —
    // це CSS-рівень, перевірено живим стендом нижче, не тут); .period і
    // .rval лишаються СВОЇМИ окремими вузлами поруч, не витісненими.
    expect(row.querySelector('[class*="_rmeta-wide_"]')!.textContent).toBe(long);
    expect(row.querySelector('[class*="_period_"]')).not.toBeNull();
    // source: 'catalog' — nowProgress не рахує прогрес (лише для власного
    // 'user'), тож право — повна довжина періоду, не «N-й день з M».
    expect(row.querySelector('[class*="_rval_"]')!.textContent).toBe('21 день');
  });

  it('живий стенд 20.09: CSS-механіка проти розпирання рядка довгою метою — .content:min-width явним числом (не auto/0), .rmeta:min-width:0', () => {
    // jsdom не вантажить справжні CSS-правила (document.styleSheets.length
    // === 0 при рендері сторінки, задокументовано з Р181) — ні
    // getComputedStyle, ні власний рендер тут не бачать явних px/ellipsis.
    // Живою перевіркою в БРАУЗЕРІ підтверджено: `.content` computed
    // min-width 128px (8em), `.rmeta` computed min-width 0px — з довгою
    // метою (300 символів) `.zone-card.scrollWidth === clientWidth` (без
    // overflow), правий край `.rval` === правий край контенту картки.
    // Тут — регресійний контроль ЛИШЕ на присутність цих двох властивостей
    // у джерелі, щоб випадкове видалення не пройшло непоміченим.
    const css = readFileSync(resolve(fileURLToPath(import.meta.url), '..', 'Calendar.module.css'), 'utf8');
    const ruleOf = (selector: string) => {
      const start = css.indexOf(selector);
      const end = css.indexOf('}', start);
      return css.slice(start, end + 1);
    };
    const contentRule = ruleOf('.content {');
    expect(contentRule).toMatch(/min-width:\s*8em/);
    expect(contentRule).not.toMatch(/min-width:\s*(auto|0)\b/);
    const rmetaRule = ruleOf('.rmeta {');
    expect(rmetaRule).toMatch(/min-width:\s*0\b/);
  });

  it('порожньо — «Нічого не діє»', async () => {
    ({ host, root } = await mount(true, [], []));
    expect(host!.querySelector('[data-cal-today-empty]')!.textContent).toBe('Нічого не діє');
  });
});

describe('CalendarPage · «Далі» (одна картка, роздільники місяців — рішення власника 20.09)', () => {
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
    // Живий стенд 20.09: подія · період · дні — три окремі значення, не один комбінований рядок.
    expect(ahead.textContent).toContain('калорійніше');
    expect(ahead.textContent).toContain('30.09 – 30.10');
    expect(ahead.textContent).toContain('31 день');
  });

  it('рядок-кінець для власного періоду, що вже діє («Без молочного» → кінець)', async () => {
    ({ host, root } = await mount(true, [], fixtureEvents()));
    const ahead = host!.querySelector('[data-cal-ahead]')!;
    const rows = [...ahead.querySelectorAll('[class*="_row_"]')].map((r) => r.textContent ?? '');
    expect(rows.some((r) => r.includes('Без молочного') && r.includes('кінець'))).toBe(true);
  });

  it('власний період, що СТАРТУЄ в горизонті («Набір ваги»), дає ОБИДВА рядки — старт і кінець', async () => {
    ({ host, root } = await mount(true, [], fixtureEvents()));
    const ahead = host!.querySelector('[data-cal-ahead]')!;
    const weight = [...ahead.querySelectorAll('[class*="_row_"]')].filter((r) => r.textContent?.includes('Набір ваги'));
    expect(weight.length).toBe(2);
    expect(weight.some((r) => r.textContent?.includes('кінець'))).toBe(true);
    expect(weight.some((r) => r.textContent?.includes('31 день'))).toBe(true);
  });

  it('каталожний тривалий (піст) — лише рядок-старт із повною метою, без окремого «кінець»', async () => {
    ({ host, root } = await mount(true, [], fixtureEvents()));
    const ahead = host!.querySelector('[data-cal-ahead]')!;
    const fast = [...ahead.querySelectorAll('[class*="_row_"]')].filter((r) => r.textContent?.includes('Різдвяний піст'));
    expect(fast.length).toBe(1);
    expect(fast[0]!.textContent).toContain('без мʼяса, риби, молочного і яєць');
    expect(fast[0]!.textContent).toContain('28.11 – 06.01');
    expect(fast[0]!.textContent).toContain('40 днів');
  });

  it('подія · період · дні: три окремі вузли (не .line1, не .row-tall — .content/.period/.rval-days), «дні» — ink лише для тривалих', async () => {
    ({ host, root } = await mount(true, [], fixtureEvents()));
    const ahead = host!.querySelector('[data-cal-ahead]')!;
    const rows = [...ahead.querySelectorAll('button[class*="_row_"]')];
    const find = (s: string) => rows.find((r) => r.textContent?.includes(s))!;

    // Тривалий старт («Набір ваги»): мета — ЛИШЕ правило, .period — діапазон, .rval — «дні» з тоном ink.
    const weight = rows.filter((r) => r.textContent?.includes('Набір ваги')).find((r) => r.textContent?.includes('31 день'))!;
    expect(weight.hasAttribute('data-meta-wide')).toBe(true);
    expect(weight.querySelector('[class*="_rmeta-wide_"]')!.textContent).toBe('калорійніше');
    expect(weight.querySelector('[class*="_period_"]')!.textContent).toBe('30.09 – 30.10');
    const weightRval = weight.querySelector('[class*="_rval_"]')!;
    expect(weightRval.textContent).toBe('31 день');
    expect(weightRval.className).toMatch(/_rval-days_/);
    // Мобільна мета — період попереду мети: «30.09 – 30.10 · калорійніше».
    expect(weight.querySelector('[class*="_rmeta-m_"]')!.textContent).toBe('30.09 – 30.10 · калорійніше');

    // Рядок-кінець: період — повний діапазон, право «кінець», НЕ ink.
    const diet1End = rows.filter((r) => r.textContent?.includes('Без молочного')).find((r) => r.textContent?.includes('кінець'))!;
    expect(diet1End.querySelector('[class*="_period_"]')!.textContent).toBe('15.09 – 05.10');
    const endRval = diet1End.querySelector('[class*="_rval_"]')!;
    expect(endRval.textContent).toBe('кінець');
    expect(endRval.className).not.toMatch(/_rval-days_/);

    // Одноденна («Мало часу»): .period порожній (без рисок), мета «рамка дня», право нема.
    const notime = find('Мало часу');
    expect(notime.querySelector('[class*="_period_"]')!.textContent).toBe('');
    expect(notime.querySelector('[class*="_rmeta-wide_"]')!.textContent).toBe('рамка дня');
    expect(notime.hasAttribute('data-meta-mobile')).toBe(true); // «рамка дня» саме по собі теж іде в мобільну мету

    // Каталожне свято без деталей («Покрова») — ні мети, ні права, ні висоти-56.
    // Рішення власника 20.09: «Далі» несе тип/правило (aheadMeta), НЕ
    // наслідок для кухні — на відміну від «Сьогодні» (todayConsequence),
    // aheadMeta свідомо не читає `meaning` навіть для каталожного свята без
    // restricts, тож тут і лишається порожньо (не «покрова над домом…»,
    // якою ця сама подія показалась би в «Сьогодні»).
    const pokrova = find('Покрова');
    expect(pokrova.hasAttribute('data-meta-wide')).toBe(false);
    expect(pokrova.hasAttribute('data-meta-mobile')).toBe(false);
    expect(pokrova.querySelector('[class*="_rmeta_"]')).toBeNull();
    expect(pokrova.querySelector('[class*="_period_"]')!.textContent).toBe('');
  });

  it('рішення власника 20.09: ОДНА картка «Далі · N» (не картка на місяць), роздільники «Вересень»/«Жовтень»/«Листопад» усередині', async () => {
    ({ host, root } = await mount(true, [], fixtureEvents()));
    const ahead = host!.querySelector('[data-cal-ahead]')!;
    // Одна картка — один section-name «Далі», один лічильник (сума всіх
    // рядків, не по місяцю): 3+3+1 = 7 (той самий підрахунок, що раніше
    // йшов на три окремі картки).
    const names = [...ahead.querySelectorAll('[class*="_section-name_"]')].map((m) => m.textContent);
    expect(names).toEqual(['Далі']);
    const counts = [...ahead.querySelectorAll('[class*="_section-count_"]')].map((c) => c.textContent);
    expect(counts).toEqual(['7']);
    // Місяці тепер — роздільники всередині картки (mono-kicker), не власні
    // section-name; для ПЕРШОГО місяця роздільник теж є (однорідність).
    const seps = [...ahead.querySelectorAll('[class*="_month-sep_"]')].map((s) => s.textContent);
    expect(seps).toEqual(['Вересень', 'Жовтень', 'Листопад']);
    expect(ahead.querySelectorAll('[class*="_zone-card_"]').length).toBe(1);
  });

  it('порожній список при непорожньому «Сьогодні» — колонка «Далі» не рендериться', async () => {
    ({ host, root } = await mount(true, fixtureNow(), []));
    expect(host!.querySelector('[data-cal-ahead]')).toBeNull();
    expect(host!.querySelector('[data-cal-empty]')).toBeNull();
  });

  // Живий стенд 20.09: з відкритою панеллю праворуч на 1440 картка вужча за
  // вʼюпорт, а старий @media (max-width:767px) не спрацьовував — назви
  // падали до однієї літери. Перемикач тепер — `@container` на `.zone-card`
  // (ширина картки, не вʼюпорта) + підлога `.name{min-width:8em}`. jsdom тут
  // не судця: vitest у цьому проєкті не вантажить справжні CSS-правила в
  // document.styleSheets (перевірено напряму — 0 аркушів при рендері
  // сторінки), тож ні getComputedStyle, ні читання самих правил стилю не
  // бачать `container-type`/`min-width` — стенд без розкладки не має звідки
  // їх узяти. Живою перевіркою в БРАУЗЕРІ (не jsdom) підтверджено всі три
  // стани з постановки: 1440 без панелі (три колонки), з панеллю (картка
  // 449px, `.period` display:none, назва «Мало часу» на 317px), з розкритим
  // сайдбаром + панеллю (картка 351px, те саме, назва на 219px) — ніде
  // назва не впала нижче восьми em.
});

describe('CalendarPage · порожній стан', () => {
  let host: HTMLDivElement | undefined; let root: Root | undefined;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(FIXED_NOW)); });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('«Сьогодні» з «Нічого не діє» + пунктирний блок з реченням і кнопками', async () => {
    ({ host, root } = await mount(true, [], []));
    expect(host!.querySelector('[data-cal-today-empty]')).not.toBeNull();
    const empty = host!.querySelector('[data-cal-empty]')!;
    expect(empty.textContent).toContain('тут буде видно, що попереду');
    expect(empty.querySelector('[data-cal-catalog]')).not.toBeNull();
    expect(empty.querySelector('[data-cal-add]')).not.toBeNull();
    // Кнопки шапки лишаються теж — блок їх не замінює, лише називає словами.
    expect(host!.querySelectorAll('[data-cal-catalog]').length).toBe(2);
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
    // Живий стенд 20.09: PeriodSubscriptions більше не малює власний
    // заголовок (дублював шапку ArtifactPanel), а Sheet сам за замовчуванням
    // видимого імені не показує — лишав шторку каталогу зовсім без назви.
    // Рішення власника: Sheet отримав проп `title` (видимий, той самий
    // стиль, що `.rail-kicker-title` панелі) — Calendar передає його для
    // каталогу; aria-label дублює title.
    expect(host!.querySelector('[data-sheet]')!.getAttribute('aria-label')).toBe('Каталог подій');
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
    const fromToday = [...host!.querySelectorAll<HTMLButtonElement>('button')].find((b) => host!.querySelector('[data-cal-today]')!.contains(b) && b.textContent?.includes('Без молочного'))!;
    await act(async () => { fromToday.click(); });
    await act(async () => {});
    expect(usePanelStore.getState().active).toBe('event:diet1');
    const fromAhead = [...host!.querySelectorAll<HTMLButtonElement>('button')].find((b) => host!.querySelector('[data-cal-ahead]')!.contains(b) && b.textContent?.includes('Без молочного'))!;
    await act(async () => { fromAhead.click(); });
    await act(async () => {});
    expect(usePanelStore.getState().active).toBe('event:diet1');
  });
});

// Моушн-пас 20.09 (еталон — Комора Pantry.tsx: перший рендер списку — без
// входів, «список просто зʼявляється», рядок «вʼїжджає» лише коли щойно
// зʼявився ПІСЛЯ першого завантаження).
describe('CalendarPage · моушн 20.09', () => {
  let host: HTMLDivElement | undefined; let root: Root | undefined;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(FIXED_NOW)); usePanelStore.getState().clear(); });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('перший рендер — жоден рядок не має `row-fresh` (список просто зʼявляється, як у Коморі)', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/v1/now')) return jsonRes({ now: fixtureNow() });
      if (url.includes('/v1/events')) return jsonRes({ events: fixtureEvents() });
      return jsonRes({});
    }));
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<MemoryRouter><CalendarPage /></MemoryRouter>); });
    await act(async () => {});
    const rows = [...host!.querySelectorAll('button[class*="_row_"]')];
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r) => expect(r.className, r.textContent ?? '').not.toMatch(/row-fresh/));
  });

  it('нова подія після перезавантаження (setVersion) — лише вона отримує `row-fresh`, наявні рядки — ні', async () => {
    // Шторка (<600, matches:false) — на відміну від панелі (≥1200), яка
    // лише пише в usePanelStore й нічого не рендерить у host без обгортки
    // ArtifactPanel — PeriodSubscriptions реально в DOM host, «Далі»/
    // «Сьогодні» лишаються в тому самому host позаду (jsdom не знає про
    // візуальний стек — обидва доступні одразу).
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })));
    let eventsList = fixtureEvents();
    // Каталог (рівень 2, «Католицькі свята») — робочий місток до setVersion:
    // «Увімкнути всі» реально пише PUT і, за успіху, кличе onDone('subscribe')
    // → Calendar.onEventChanged(undefined,'subscribe') → той самий шлях, що
    // й будь-яка інша зміна дому. Саме на ЦЬОМУ повторному довантаженні
    // events/now підміняємо список — так, як реально приходить нова подія.
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return jsonRes({ ok: true });
      if (url.includes('/v1/now')) return jsonRes({ now: fixtureNow() });
      if (url.includes('/v1/events')) return jsonRes({ events: eventsList });
      if (url.includes('/v1/occasions/subscriptions')) return jsonRes({ subscriptions: [] });
      if (url.includes('/v1/occasions')) return jsonRes({ set: 'catholic', year: 2026, items: [] });
      return jsonRes({});
    }));
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<MemoryRouter><CalendarPage /></MemoryRouter>); });
    await act(async () => {});
    // Нова подія в горизонті «Далі» — зʼявиться лише ПІСЛЯ повторного фетчу.
    eventsList = [...fixtureEvents(), { id: 'newone', scope: 'household', kind: 'custom', title: 'Новий захід', start: day(3).getTime(), end: day(3, 23).getTime(), force: 'hint' }];
    await act(async () => { (host!.querySelector('[data-cal-catalog]') as HTMLButtonElement).click(); });
    await act(async () => {});
    const catholicPkg = [...host!.querySelectorAll('button')].find((b) => b.textContent?.includes('Католицькі свята'))!;
    await act(async () => { catholicPkg.click(); });
    await act(async () => {});
    const setOn = host!.querySelector('[data-set-toggle="on"]') as HTMLButtonElement;
    await act(async () => { setOn.click(); });
    await act(async () => {});
    const rows = [...host!.querySelectorAll('[data-cal-ahead] button[class*="_row_"]')];
    const fresh = rows.find((r) => r.textContent?.includes('Новий захід'));
    expect(fresh, 'новий рядок мав зʼявитись').not.toBeUndefined();
    expect(fresh!.className).toMatch(/row-fresh/);
    const old = rows.find((r) => r.textContent?.includes('Мало часу'));
    expect(old!.className, 'наявний рядок не мав перезайти').not.toMatch(/row-fresh/);
  });

  it('розкриття «Сезон» — шеврон отримує `chev-open`, підрядки — `subrow-in` зі зростаючим `--i`', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/v1/now')) return jsonRes({ now: fixtureNow() });
      if (url.includes('/v1/events')) return jsonRes({ events: fixtureEvents() });
      return jsonRes({});
    }));
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<MemoryRouter><CalendarPage /></MemoryRouter>); });
    await act(async () => {});
    const toggle = host!.querySelector<HTMLButtonElement>('[data-cal-season-toggle]')!;
    const chev = toggle.querySelector('[class*="_chev_"]')!;
    expect(chev.className).not.toMatch(/chev-open/);
    await act(async () => { toggle.click(); });
    expect(chev.className).toMatch(/chev-open/);
    const subrows = [...host!.querySelectorAll('button[class*="_subrow_"]')];
    expect(subrows.length).toBe(2); // Сливи, Білі гриби (fixtureNow)
    subrows.forEach((r) => expect(r.className).toMatch(/subrow-in/));
    expect((subrows[0] as HTMLElement).style.getPropertyValue('--i')).toBe('0');
    expect((subrows[1] as HTMLElement).style.getPropertyValue('--i')).toBe('1');
    await act(async () => { toggle.click(); });
    expect(chev.className).not.toMatch(/chev-open/);
  });
});
