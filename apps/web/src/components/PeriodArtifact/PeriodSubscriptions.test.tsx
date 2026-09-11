// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { PeriodSubscriptions, rowSub, nextWindows, SUBSCRIPTIONS_COPY } from './PeriodSubscriptions';
import type { OccasionItem, SubscriptionRow } from '../../api';

// PLAN §7: підписка на традицію як «увімкнути набір» + вимикання окремих;
// заглушити / повернути. Перевіряється на межі API: що саме летить у PUT.
// У проді одна подія — цей сценарій живе лише тут і на засіві.

const catholic: OccasionItem[] = [
  { occasion_id: 'xmas', title: 'Різдво', type: 'tradition', tradition: 'catholic', from: '2026-12-25', to: '2026-12-25', enabled: false, what: 'святкова вечеря', strict: false },
  { occasion_id: 'lent', title: 'Великий піст', type: 'tradition', tradition: 'catholic', from: '2027-02-18', to: '2027-04-04', approx: true, enabled: false, what: 'піст', strict: true },
];
const seasons: OccasionItem[] = [
  { occasion_id: 'tomato', title: 'Помідори', type: 'season', tradition: null, from: '2026-07-20', to: '2026-09-30', approx: true, enabled: true, what: 'сезон', strict: false },
  { occasion_id: 'ramson', title: 'Черемша', type: 'season', tradition: null, from: '2027-04-01', to: '2027-05-15', approx: true, enabled: false, what: 'сезон', strict: false },
];

describe('rowSub', () => {
  const today = '2026-09-10';
  it('свято — проміжок · що робить; суворе — «суворо»; «≈» коли дати рахуються', () => {
    expect(rowSub({ ...catholic[0]!, enabled: true }, true, today)).toBe('25 груд · святкова вечеря');
    expect(rowSub({ ...catholic[1]!, enabled: true }, true, today)).toBe('≈ 18 лют – 4 квіт · суворо');
  });
  it('сезон — кінцем, поки триває; початком, поки не почався', () => {
    expect(rowSub(seasons[0]!, true, today)).toBe('≈ до 30 вер');
    expect(rowSub({ ...seasons[1]!, enabled: true }, true, today)).toBe('≈ з 1 квіт');
    // Минулий сезон — теж початком: він річний і прийде знову.
    expect(rowSub({ ...seasons[0]!, from: '2026-04-01', to: '2026-05-15' }, true, today)).toBe('≈ з 1 квіт');
  });
  it('знятий у живому наборі — «заглушено · повернути»; у не підключеній традиції — просто дати', () => {
    expect(rowSub(seasons[1]!, true, today)).toBe(SUBSCRIPTIONS_COPY.muted);
    expect(rowSub(catholic[0]!, false, today)).toBe('25 груд · святкова вечеря');
  });
});

describe('nextWindows', () => {
  it('минуле вікно цього року → вікно наступного; порядок за найближчим', () => {
    const ramadan26 = { ...catholic[0]!, occasion_id: 'ramadan', title: 'Рамадан', from: '2026-02-18', to: '2026-03-19', approx: true };
    const ramadan27 = { ...ramadan26, from: '2027-02-08', to: '2027-03-09' };
    const out = nextWindows([ramadan26, catholic[0]!], [ramadan27, { ...catholic[0]!, from: '2027-12-25', to: '2027-12-25' }], '2026-09-10');
    expect(out.map((r) => [r.occasion_id, r.from])).toEqual([['xmas', '2026-12-25'], ['ramadan', '2027-02-08']]);
    expect(out[1]!.approx).toBe(true);
  });
});

describe('PeriodSubscriptions', () => {
  let host: HTMLDivElement | undefined; let root: Root | undefined;
  let puts: unknown[] = [];
  let subs: SubscriptionRow[] = [];
  let rowsBySet: Record<string, OccasionItem[]> = {};
  beforeEach(() => {
    puts = [];
    subs = [];
    rowsBySet = { catholic, orthodox: [], seasons };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
      if (init?.method === 'PUT') { const body = JSON.parse(init.body as string); puts.push(body); return json({ written: body, subscriptions: body }); }
      if (url.includes('/v1/occasions/subscriptions')) return json({ subscriptions: subs });
      const q = new URL(url, 'http://x').searchParams;
      const set = q.get('set')!;
      // Наступний рік — ті самі рядки, зсунуті на рік: у тестах вікна цього року ще не минули.
      const items = (rowsBySet[set] ?? []).map((r) => q.get('year') === '2027' ? { ...r, from: r.from!.replace(/^\d{4}/, '2027'), to: r.to!.replace(/^\d{4}/, '2027') } : r);
      return json({ set, year: Number(q.get('year')), items });
    }));
  });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); });
  async function mount(el: React.ReactElement) {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<MemoryRouter>{el}</MemoryRouter>); });
    await act(async () => {}); // другий тік — довідник дочитався
  }
  const click = async (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
  const $ = (sel: string) => host!.querySelector(sel);
  const switchOf = (id: string) => $(`[data-occasion="${id}"] [role="switch"]`) as HTMLButtonElement;

  it('«увімкнути набір» — PUT усіма рядками традиції enabled:true, чіп стає увімкненим', async () => {
    const onDone = vi.fn();
    await mount(<PeriodSubscriptions initialSet="catholic" onDone={onDone} />);
    expect($('[role="tab"][aria-selected="true"]')!.textContent).toBe('Католицькі');
    expect($('[role="tab"][data-on]')).toBeNull();
    expect($('[data-set-toggle]')!.textContent).toBe(SUBSCRIPTIONS_COPY.setOn);
    // Не підключена традиція — рядки не «заглушені», а з датами.
    expect($('[data-occasion="xmas"]')!.textContent).not.toContain(SUBSCRIPTIONS_COPY.muted);
    await click($('[data-set-toggle="on"]'));
    expect(puts).toEqual([[{ occasion_id: 'xmas', enabled: true }, { occasion_id: 'lent', enabled: true }]]);
    expect($('[role="tab"][data-on]')!.textContent).toBe('Католицькі');
    expect($('[data-set-toggle]')!.textContent).toBe(SUBSCRIPTIONS_COPY.setOff);
    expect(switchOf('lent').getAttribute('aria-checked')).toBe('true');
    expect(onDone).toHaveBeenCalledWith('subscribe');
  });

  it('вимкнути окреме — PUT одним рядком; рядок лишається як «заглушено · повернути»; повернути — той самий перемикач', async () => {
    rowsBySet.catholic = catholic.map((r) => ({ ...r, enabled: true }));
    subs = [{ occasion_id: 'xmas', enabled: true, updated_at: '', title: 'Різдво', type: 'tradition', tradition: 'catholic' }];
    await mount(<PeriodSubscriptions initialSet="catholic" />);
    await click(switchOf('xmas'));
    expect(puts).toEqual([[{ occasion_id: 'xmas', enabled: false }]]);
    expect($('[data-occasion="xmas"]')!.textContent).toContain(SUBSCRIPTIONS_COPY.muted);
    expect($('[data-occasion="xmas"]')!.hasAttribute('data-enabled')).toBe(false);
    // Набір ще увімкнений — піст лишився.
    expect($('[data-set-toggle]')!.textContent).toBe(SUBSCRIPTIONS_COPY.setOff);
    await click(switchOf('xmas'));
    expect(puts[1]).toEqual([{ occasion_id: 'xmas', enabled: true }]);
    expect($('[data-occasion="xmas"]')!.textContent).toContain('25 груд');
  });

  it('«вимкнути набір» — усі рядки enabled:false; сезони живуть у тій самій картці', async () => {
    rowsBySet.catholic = catholic.map((r) => ({ ...r, enabled: true }));
    await mount(<PeriodSubscriptions initialSet="catholic" />);
    await click($('[data-set-toggle="off"]'));
    expect(puts).toEqual([[{ occasion_id: 'xmas', enabled: false }, { occasion_id: 'lent', enabled: false }]]);
    expect($('[role="tab"][data-on]')).toBeNull();
    expect($('[data-occasion="ramson"]')!.textContent).toContain(SUBSCRIPTIONS_COPY.muted);
    await click(switchOf('ramson'));
    expect(puts[1]).toEqual([{ occasion_id: 'ramson', enabled: true }]);
  });

  it('відкрили «приховані» — показує першу увімкнену традицію, не православні за замовчуванням', async () => {
    subs = [{ occasion_id: 'xmas', enabled: true, updated_at: '', title: 'Різдво', type: 'tradition', tradition: 'catholic' }];
    await mount(<PeriodSubscriptions initialSet="seasons" />);
    expect($('[role="tab"][aria-selected="true"]')!.textContent).toContain('Католицькі');
  });

  it('PUT упав — помилка, стан не міняється', async () => {
    await mount(<PeriodSubscriptions initialSet="catholic" />);
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => new Response('{}', { status: 500 }));
    await click($('[data-set-toggle="on"]'));
    expect(host!.textContent).toContain(SUBSCRIPTIONS_COPY.err);
    expect($('[role="tab"][data-on]')).toBeNull();
  });
});
