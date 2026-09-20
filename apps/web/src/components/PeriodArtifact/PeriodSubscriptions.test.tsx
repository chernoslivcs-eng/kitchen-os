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

  // Живий стенд 20.09: «Каталог подій» дублювався — той самий текст уже в
  // шапці ArtifactPanel (label з Calendar.tsx), і ще раз власним <h2> тут.
  // Компонент більше не малює заголовок сам — лишає це шапці панелі.
  it('немає власного заголовка «Каталог подій» (його несе шапка панелі, не цей компонент)', async () => {
    await mount(<PeriodSubscriptions />);
    expect(host!.textContent).not.toContain('Каталог подій');
    expect(host!.querySelector('h2')).toBeNull();
    // Пояснення лишається першим рядком змісту.
    expect(host!.textContent?.trim().startsWith('Підпишись на пакет')).toBe(true);
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

  // Рішення власника 20.09: кнопку «Твій»/«Увімкнути» прибрано з рядка
  // пакета — рядок ЛИШЕ веде всередину (рівень 2, де тепер обидва
  // «Увімкнути всі»/«Вимкнути всі» завжди видимі). Підпис під назвою несе
  // статус: увімкнено — «Відслідковується · N подій[· M вимкнено]»;
  // вимкнено — сама кількість, без слова статусу.
  it('рядок пакета — сама кнопка (без окремої кнопки «Твій»/«Увімкнути»), статус-підпис у трьох станах', async () => {
    // offCount() рахує з `subs` (відхилення від дефолту), не з per-item
    // enabled у фікстурі — явний рядок відхилення на ramson, щоб «N вимкнено»
    // справді мала що показати.
    subs = [{ occasion_id: 'ramson', enabled: false, updated_at: '', title: 'Черемша', type: 'season', tradition: null }];
    await mount(<PeriodSubscriptions />);
    const catholicPkg = $('[data-package="catholic"]')!;
    // Католицькі: xmas/lent обидва enabled:false — весь пакет вимкнений.
    expect(catholicPkg.querySelectorAll('button').length).toBe(1);
    expect(catholicPkg.textContent).toContain('2 події');
    expect(catholicPkg.textContent).not.toContain(SUBSCRIPTIONS_COPY.mine);

    // Сезони: tomato on, ramson off — частково увімкнено → статус є, і «1 вимкнено».
    const seasonsPkg = $('[data-package="seasons"]')!;
    expect(seasonsPkg.textContent).toContain(SUBSCRIPTIONS_COPY.mine);
    expect(seasonsPkg.textContent).toContain('2 вікна');
    expect(seasonsPkg.textContent).toContain('1 вимкнено');
  });

  it('усі підписки пакета увімкнені — статус є, «N вимкнено» нема', async () => {
    rowsBySet.seasons = seasons.map((r) => ({ ...r, enabled: true }));
    await mount(<PeriodSubscriptions />);
    const seasonsPkg = $('[data-package="seasons"]')!;
    expect(seasonsPkg.textContent).toContain(SUBSCRIPTIONS_COPY.mine);
    expect(seasonsPkg.textContent).not.toContain('вимкнено');
  });

  it('тап по рядку пакета відкриває рівень 2', async () => {
    await mount(<PeriodSubscriptions />);
    await click($('[data-package="catholic"] button'));
    expect($('[data-catalog-level]')!.getAttribute('data-catalog-level')).toBe('items');
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

  // Рішення власника 20.09: обидві дії («Увімкнути всі»/«Вимкнути всі»)
  // завжди видимі зверху списку разом, не одна за станом.
  it('«Вимкнути всі» (рівень 2) — усі рядки enabled:false', async () => {
    rowsBySet.catholic = catholic.map((r) => ({ ...r, enabled: true }));
    await mount(<PeriodSubscriptions initialSet="catholic" />);
    expect($('[data-set-toggle="on"]')).not.toBeNull();
    expect($('[data-set-toggle="off"]')).not.toBeNull();
    await click($('[data-set-toggle="off"]'));
    expect(puts).toEqual([[{ occasion_id: 'xmas', enabled: false }, { occasion_id: 'lent', enabled: false }]]);
    expect($('[data-occasion="ramson"]')).toBeNull(); // це не сезони — інший пакет
  });

  it('«Увімкнути всі» (рівень 2) — усі рядки enabled:true', async () => {
    await mount(<PeriodSubscriptions initialSet="catholic" />);
    await click($('[data-set-toggle="on"]'));
    expect(puts).toEqual([[{ occasion_id: 'xmas', enabled: true }, { occasion_id: 'lent', enabled: true }]]);
  });

  it('PUT упав — помилка, стан не міняється', async () => {
    rowsBySet.catholic = catholic.map((r) => ({ ...r, enabled: true }));
    await mount(<PeriodSubscriptions initialSet="catholic" />);
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => new Response('{}', { status: 500 }));
    await click($('[data-set-toggle="off"]'));
    expect(host!.textContent).toContain(SUBSCRIPTIONS_COPY.err);
  });
});
