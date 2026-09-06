// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { PeriodSeries, PeriodEvent } from './PeriodArtifact';
import type { ChatCard, EventOccurrence } from '../../api';

// П2: серія — галочка перемикається, лічильник, PUT батчем усіх рядків;
// подія своя — PATCH з from/to/rule_text/strict; системна — лише
// «Не показувати» з enabled:false; дубль заголовка не рендериться.

const jewish: ChatCard = {
  type: 'period', kind: 'tradition', tradition: 'jewish',
  items: [
    { occasion_id: 'rosh', title: 'Рош га-Шана', from: '2026-09-11', to: '2026-09-13', enabled: false, what: 'святкова вечеря', strict: false },
    { occasion_id: 'yom-kippur', title: 'Йом Кіпур', from: '2026-09-20', to: '2026-09-21', enabled: false, what: 'піст', strict: false },
    { occasion_id: 'pesach', title: 'Песах', from: '2027-04-21', to: '2027-04-29', enabled: false, what: 'докупити', strict: false },
  ],
};

const own: EventOccurrence = {
  id: 'e1', scope: 'household', kind: 'diet', title: 'білкова', start: Date.UTC(2026, 8, 1), end: Date.UTC(2026, 8, 30),
  force: 'hint', strict: false, rule_text: 'білкова — більше білка, менше вуглеводів', from: '2026-09-01', to: '2026-09-30',
  rule: { t: 'once', at: '2026-09-01', days: 30 },
};

const season: EventOccurrence = {
  id: 'mushroom', scope: 'catalog', kind: 'season', title: 'сезон білих грибів', start: Date.UTC(2026, 8, 1), end: Date.UTC(2026, 9, 31),
  force: 'hint', strict: false, meaning: 'Свіжі білі бувають кілька тижнів на рік.', buy: ['білі гриби', 'рис арборіо'], seeds: ['різото з білими'],
};

describe('PeriodArtifact', () => {
  let host: HTMLDivElement | undefined; let root: Root | undefined;
  let calls: { url: string; method: string; body: unknown }[] = [];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : null });
      return new Response(JSON.stringify({ written: [], subscriptions: [], event: { id: 'e1' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
  });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); });
  async function mount(el: React.ReactElement) {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<MemoryRouter>{el}</MemoryRouter>); });
  }
  const click = async (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
  const byText = (text: string) => [...host!.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null;
  const setValue = async (el: HTMLInputElement, v: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  it('серія: галочки перемикаються, лічильник, PUT батчем усіх рядків, потім apply з індексами увімкнених', async () => {
    const onApply = vi.fn(async () => {});
    await mount(<PeriodSeries card={jewish} cardId="c1" onApply={onApply} />);
    expect(host!.textContent).toContain('юдейські свята');
    // З чату — усе увімкнене від початку, знімають зайве.
    expect(host!.textContent).toContain('3 з 3');
    await click(host!.querySelector('[data-occasion="yom-kippur"]'));
    expect(host!.textContent).toContain('2 з 3');
    await click(host!.querySelector('[data-occasion="pesach"]'));
    await click(host!.querySelector('[data-occasion="pesach"]'));
    expect(host!.textContent).toContain('2 з 3');
    await click(byText('Записати в календар'));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toMatchObject({ url: '/v1/occasions/subscriptions' });
    expect(put!.body).toEqual([
      { occasion_id: 'rosh', enabled: true }, { occasion_id: 'yom-kippur', enabled: false }, { occasion_id: 'pesach', enabled: true },
    ]);
    expect(onApply).toHaveBeenCalledWith([0, 2]);
    expect(host!.textContent).toContain('Записано в календар: 2');
  });

  it('серія з календаря: галочки як у підписці; усе зняте → «Пропущено», apply не кличеться', async () => {
    const onApply = vi.fn(async () => {}); const onDismiss = vi.fn();
    await mount(<PeriodSeries card={{ ...jewish, items: jewish.items!.slice(0, 1) }} cardId="c1" onApply={onApply} onDismiss={onDismiss} />);
    await click(host!.querySelector('[data-occasion="rosh"]'));
    expect(host!.textContent).toContain('0 з 1');
    await click(byText('Записати в календар'));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual([{ occasion_id: 'rosh', enabled: false }]);
    expect(onApply).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it('серія з календаря: непідписана традиція — усе увімкнене; сезони — як у підписці', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : null });
      const seasons = url.includes('set=seasons');
      const items = seasons
        ? [{ occasion_id: 'melon', title: 'кавуни', type: 'season', tradition: null, from: '2026-08-01', to: '2026-09-30', enabled: false, what: 'сезон', strict: false },
           { occasion_id: 'mushroom', title: 'гриби', type: 'season', tradition: null, from: '2026-09-01', to: '2026-10-31', enabled: true, what: 'сезон', strict: false }]
        : [{ occasion_id: 'advent', title: 'Адвент', type: 'tradition', tradition: 'catholic', from: '2026-12-01', to: '2026-12-23', enabled: false, what: 'докупити', strict: false },
           { occasion_id: 'xmas-cath', title: 'Різдво', type: 'tradition', tradition: 'catholic', from: '2026-12-24', to: '2026-12-26', enabled: false, what: 'докупити', strict: false }];
      return new Response(JSON.stringify({ set: seasons ? 'seasons' : 'catholic', year: 2026, items, written: [], subscriptions: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    await mount(<PeriodSeries set="catholic" />);
    expect(host!.textContent).toContain('2 з 2');
    await act(async () => { root!.unmount(); });
    await mount(<PeriodSeries set="seasons" />);
    expect(host!.textContent).toContain('1 з 2');
    expect(host!.querySelector('[data-occasion="melon"]')!.className).toContain('item-off');
  });

  it('серія записана — галочки не перемикаються, кнопки нема', async () => {
    await mount(<PeriodSeries card={jewish} cardId="c1" applied />);
    await click(host!.querySelector('[data-occasion="rosh"]'));
    expect(host!.textContent).toContain('Записано в календар');
    expect(byText('Записати в календар')).toBeNull();
  });

  it('подія своя: дубль заголовка не рендериться в читанні; правка → PATCH з from/to/rule_text/strict', async () => {
    const onChanged = vi.fn();
    await mount(<PeriodEvent event={own} onChanged={onChanged} />);
    // Форма своя — редагується: заголовок і правило як поля.
    const title = host!.querySelector<HTMLInputElement>('input[aria-label="Назва"]')!;
    expect(title.value).toBe('білкова');
    await setValue(host!.querySelector<HTMLInputElement>('input[aria-label="До"]')!, '2026-10-05');
    await click(byText('мʼяко'));
    expect(byText('суворо')).not.toBeNull();
    expect(host!.textContent).toContain('не пропоную сам; попросиш прямо — попереджу і зроблю');
    await click(byText('Записати'));
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch).toMatchObject({ url: '/v1/events/e1', body: { kind: 'diet', from: '2026-09-01', to: '2026-10-05', rule_text: 'білкова — більше білка, менше вуглеводів', strict: true, title: 'білкова' } });
    expect(onChanged).toHaveBeenCalledWith('e1', 'edit');
  });

  it('подія своя, записана з чату: заголовок, що дублюється правилом, не показується двічі', async () => {
    const card: ChatCard = { type: 'period', kind: 'diet', title: 'білкова', rule_text: 'білкова — більше білка', resolved: { from: '2026-09-06', to: '2026-10-05' } };
    await mount(<PeriodEvent card={card} cardId="c2" applied />);
    expect(host!.querySelector('h2')).toBeNull();
    expect(host!.textContent).toContain('білкова — більше білка');
    expect((host!.textContent!.match(/білкова/g) ?? []).length).toBe(1);
    expect(host!.textContent).toContain('Записано в календар');
  });

  it('подія системна: без полів і перемикача роду; «Не показувати» → PUT enabled:false, тост із «Повернути»', async () => {
    const onChanged = vi.fn();
    await mount(<PeriodEvent event={season} onChanged={onChanged} />);
    expect(host!.querySelector('input')).toBeNull();
    expect(host!.querySelector('[role="tablist"]')).toBeNull();
    expect(host!.textContent).toContain('сезон · з довідника');
    expect(host!.textContent).toContain('Свіжі білі бувають');
    expect(byText('Записати')).toBeNull();
    await click(byText('Не показувати'));
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/v1/occasions/subscriptions', body: [{ occasion_id: 'mushroom', enabled: false }] });
    expect(onChanged).toHaveBeenCalledWith('mushroom', 'mute');
    expect(host!.textContent).toContain('Приховано.');
    await click(byText('Повернути'));
    expect(calls.filter((c) => c.method === 'PUT').at(-1)!.body).toEqual([{ occasion_id: 'mushroom', enabled: true }]);
  });

  it('нова подія з календаря: гості на один день → POST kind custom з датою', async () => {
    const onChanged = vi.fn();
    await mount(<PeriodEvent initial={{ date: '2026-09-12' }} onChanged={onChanged} />);
    await click(byText('подія дому'));
    await setValue(host!.querySelector<HTMLInputElement>('input[aria-label="Назва"]')!, 'гості');
    await setValue(host!.querySelector<HTMLInputElement>('input[aria-label="Правило"]')!, 'на шістьох');
    await click(byText('Записати'));
    const post = calls.find((c) => c.method === 'POST');
    expect(post).toMatchObject({ url: '/v1/events', body: { title: 'гості', kind: 'custom', from: '2026-09-12', to: '2026-09-12', rule_text: 'на шістьох', strict: false } });
    expect(onChanged).toHaveBeenCalledWith('e1', 'add');
  });
});
