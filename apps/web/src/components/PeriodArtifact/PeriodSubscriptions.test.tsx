// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { PeriodSubscriptions, rowSub, nextWindows, SUBSCRIPTIONS_COPY } from './PeriodSubscriptions';
import type { OccasionItem, SubscriptionRow } from '../../api';

// Календар v3 (spec 18.09, К7): каталог — пакети (рівень 1) → вміст пакета
// (рівень 2), не чіпи+рядки на одному екрані. Контракт API той самий —
// перевіряється на межі: що саме летить у PUT.

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
    rowsBySet = { catholic, seasons, orthodox: [], islamic: [], jewish: [], secular: [] };
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
    await act(async () => {});
  }
  const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await act(async () => {}); };
  const $ = (sel: string) => host!.querySelector(sel);
  const switchOf = (id: string) => $(`[data-occasion="${id}"] [role="switch"]`) as HTMLButtonElement;

  // «Своя подія» переїхала в шапку календаря (рішення власника 19.09) — тут
  // її вже нема, лише пакети.
  it('без initialSet — рівень 1, шість пакетів з лічильниками', async () => {
    await mount(<PeriodSubscriptions />);
    expect($('[data-catalog-level]')!.getAttribute('data-catalog-level')).toBe('packages');
    expect($('[data-package="catholic"]')!.textContent).toContain('2 події');
    expect($('[data-package="seasons"]')!.textContent).toContain('2 вікна');
  });

  it('клік по рядку пакета — переходить у вміст (рівень 2) з кнопкою «назад»', async () => {
    await mount(<PeriodSubscriptions />);
    await click($('[data-package="catholic"] button'));
    expect($('[data-catalog-level]')!.getAttribute('data-catalog-level')).toBe('items');
    expect(host!.textContent).toContain('Католицькі свята');
    expect($('[data-occasion="xmas"]')).not.toBeNull();
    await click($('[aria-label="Назад до пакетів"]'));
    expect($('[data-catalog-level]')!.getAttribute('data-catalog-level')).toBe('packages');
  });

  it('initialSet="catholic" — одразу рівень 2 (вхід із конкретного пакета)', async () => {
    await mount(<PeriodSubscriptions initialSet="catholic" />);
    expect($('[data-catalog-level]')!.getAttribute('data-catalog-level')).toBe('items');
    expect(host!.textContent).toContain('Католицькі свята');
  });

  it('«Увімкнути» на пакеті (рівень 1) — PUT усіма рядками пакета, кнопка стає «Твій»', async () => {
    const onDone = vi.fn();
    await mount(<PeriodSubscriptions onDone={onDone} />);
    const btn = $('[data-package-toggle="catholic"]')!;
    expect(btn.textContent).toBe('Увімкнути');
    await click(btn);
    expect(puts).toEqual([[{ occasion_id: 'xmas', enabled: true }, { occasion_id: 'lent', enabled: true }]]);
    expect($('[data-package-toggle="catholic"]')!.textContent).toBe(SUBSCRIPTIONS_COPY.mine);
    expect(onDone).toHaveBeenCalledWith('subscribe');
  });

  // Живий клік власника в каталозі 19.09: «Твій» на сезонах був статичним
  // написом (`packageOn('seasons')` — константа `true`) — тап після
  // часткового вимкнення нічого не робив. Тепер сезони — той самий
  // перемикач пакета, що традиції: «Твій» ↔ «Увімкнути», за ЕФЕКТИВНИМ
  // станом пунктів (не всі вимкнені), як traditions.
  it('«Твій» на сезонах — перемикач, не напис: частково вимкнено → «Твій»; тап вимикає всі 2 разом', async () => {
    const onDone = vi.fn();
    await mount(<PeriodSubscriptions onDone={onDone} />);
    const btn = $('[data-package-toggle="seasons"]')!;
    // tomato enabled:true, ramson enabled:false — хоч один увімкнений → «Твій».
    expect(btn.textContent).toBe(SUBSCRIPTIONS_COPY.mine);
    await click(btn);
    expect(puts).toEqual([[{ occasion_id: 'tomato', enabled: false }, { occasion_id: 'ramson', enabled: false }]]);
    expect($('[data-package-toggle="seasons"]')!.textContent).toBe('Увімкнути');
    expect(onDone).toHaveBeenCalledWith('subscribe');
  });

  it('сезони всі вимкнені — «Увімкнути»; тап вмикає всі разом, стає «Твій»', async () => {
    rowsBySet.seasons = seasons.map((r) => ({ ...r, enabled: false }));
    await mount(<PeriodSubscriptions />);
    const btn = $('[data-package-toggle="seasons"]')!;
    expect(btn.textContent).toBe('Увімкнути');
    await click(btn);
    expect(puts).toEqual([[{ occasion_id: 'tomato', enabled: true }, { occasion_id: 'ramson', enabled: true }]]);
    expect($('[data-package-toggle="seasons"]')!.textContent).toBe(SUBSCRIPTIONS_COPY.mine);
  });

  it('вимкнути окреме в рівні 2 — PUT одним рядком; рядок лишається як «заглушено · повернути»; повернути — той самий перемикач', async () => {
    rowsBySet.catholic = catholic.map((r) => ({ ...r, enabled: true }));
    subs = [{ occasion_id: 'xmas', enabled: true, updated_at: '', title: 'Різдво', type: 'tradition', tradition: 'catholic' }];
    await mount(<PeriodSubscriptions initialSet="catholic" />);
    await click(switchOf('xmas'));
    expect(puts).toEqual([[{ occasion_id: 'xmas', enabled: false }]]);
    expect($('[data-occasion="xmas"]')!.textContent).toContain(SUBSCRIPTIONS_COPY.muted);
    expect($('[data-occasion="xmas"]')!.hasAttribute('data-enabled')).toBe(false);
    await click(switchOf('xmas'));
    expect(puts[1]).toEqual([{ occasion_id: 'xmas', enabled: true }]);
    expect($('[data-occasion="xmas"]')!.textContent).toContain('25 груд');
  });

  it('«вимкнути набір» (рівень 2) — усі рядки enabled:false; «Вимкнути пакет» унизу робить те саме', async () => {
    rowsBySet.catholic = catholic.map((r) => ({ ...r, enabled: true }));
    await mount(<PeriodSubscriptions initialSet="catholic" />);
    await click($('[data-set-toggle="off"]'));
    expect(puts).toEqual([[{ occasion_id: 'xmas', enabled: false }, { occasion_id: 'lent', enabled: false }]]);
    expect($('[data-occasion="ramson"]')).toBeNull(); // це не сезони — інший пакет
  });

  it('«Вимкнути пакет» (кнопка підвалу рівня 2) — та сама дія, що «вимкнути набір»', async () => {
    rowsBySet.catholic = catholic.map((r) => ({ ...r, enabled: true }));
    await mount(<PeriodSubscriptions initialSet="catholic" />);
    const offPkg = [...host!.querySelectorAll('button')].find((b) => b.textContent?.includes(SUBSCRIPTIONS_COPY.offPackage));
    await click(offPkg ?? null);
    expect(puts).toEqual([[{ occasion_id: 'xmas', enabled: false }, { occasion_id: 'lent', enabled: false }]]);
  });

  it('PUT упав — помилка, стан не міняється', async () => {
    rowsBySet.catholic = catholic.map((r) => ({ ...r, enabled: true }));
    await mount(<PeriodSubscriptions initialSet="catholic" />);
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => new Response('{}', { status: 500 }));
    await click($('[data-set-toggle="off"]'));
    expect(host!.textContent).toContain(SUBSCRIPTIONS_COPY.err);
  });
});
