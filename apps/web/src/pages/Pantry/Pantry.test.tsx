// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { PantryPage } from './Pantry';
import type { PantryBatch } from '../../api';
import { usePanelStore } from '../../store/panel';

// Раунд 5, крок Ф1: рейки фільтра на сторінці — «стан» не вмикає третій,
// «скинути» повертає групи, сортування дає плаский список з колонкою.

// Етап 2a: фікстури дістали `catalog_key`. Доти всі мали `null`, і тести
// перевіряли строк, порахований із таблиці ЗОН, — тобто здогадку, а не знання.
// Позиція без ключа тепер шкали не має взагалі (PLAN §2), і саме на неї
// заведено окремий випадок нижче.
const b = (label: string, over: Partial<PantryBatch> = {}): PantryBatch => ({
  id: label, household_id: 'h1', catalog_key: `key_${label}`, label, zone: 'fridge', value: 100, unit: 'g', state: 'sealed',
  opened_at: null, expires_at: null, best_before_opened_days: null, added_at: '2026-09-01T00:00:00.000Z', depleted_at: null,
  confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: null,
  cat: null, kcal: null, fat: null, prot: null, carb: null, est: null, days: null, receipt: false, no: null, added: 5, ...over,
});
const ITEMS = [
  b('Пармезан', { cat: 'сири', fat: 25.8, kcal: 392, prot: 35.8, carb: 3.2, est: false }),
  b('Куряче філе', { cat: 'мʼясо', fat: 2.6, kcal: 114, prot: 22.5, carb: 0, est: false, days: 2, receipt: true, no: 'не їм' }),
  b('Огірки', { cat: 'овочі', fat: 0.1, kcal: 15, prot: 0.7, carb: 3.6, est: true, zone: 'fresh', receipt: true, days: 0 }),
  b('Засіб для скла', { zone: 'dry' }),
];

let host: HTMLDivElement | undefined; let root: Root | undefined;
beforeEach(() => {
  usePanelStore.setState({ artifacts: [], active: null, open: false });
  // панель артефактів дивиться на ширину вʼюпорту; jsdom не має matchMedia
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('/v1/pantry')) return json({ household_id: 'h1', count: ITEMS.length, batches: ITEMS, products: [], last_receipt_at: '2026-09-03T10:00:00.000Z' });
    if (url.startsWith('/v1/shopping')) return json({ count: 0, items: [] });
    return json({});
  }));
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove(); host = undefined; root = undefined;
  vi.unstubAllGlobals();
});
async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter><PantryPage /></MemoryRouter>); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
// Шапка за Screens: рейки порядку/тільки/стану — за кнопкою «Фільтр»; тест
// спершу її відкриває, якщо рейок ще нема.
const openFilter = async () => {
  if (!host!.querySelector('[data-testid="filter-rails"]')) {
    await act(async () => { host!.querySelector<HTMLButtonElement>('[data-filter-toggle]')!.click(); });
  }
};
const word = (label: string) => [...host!.querySelectorAll<HTMLButtonElement>('[data-testid="filter-rails"] button')].find((x) => x.textContent === label)!;
const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); };
const names = () => [...host!.querySelectorAll<HTMLElement>('[data-batch]')].map((x) => x.dataset.batch);

// Етап 1.6 (рішення Р20): капс знято. Він був вписаний не лише в CSS, а й
// у самі рядки — тому лічильник тепер «6 позицій», а не «6 ПОЗИЦІЙ».
// Тест переписаний свідомо, а не видалений: він і далі стежить за формою
// лічильника, просто форма змінилась разом із каноном.
describe('PantryPage · фільтр', () => {
  it('за замовчуванням — групи за місцем і лічильник «N позицій»; за жирністю — плаский список спадно, без значення в кінці', async () => {
    await mount();
    expect(host!.querySelectorAll('[data-zone]').length).toBe(3);
    expect(host!.querySelector('[data-testid="pantry-meta"]')!.textContent).toBe('4 позиції');
    await openFilter();
    await click(word('за жирністю'));
    expect(host!.querySelectorAll('[data-zone]').length).toBe(0);
    expect(host!.querySelector('[data-testid="flat-list"]')).not.toBeNull();
    expect(names()).toEqual(['Пармезан', 'Куряче філе', 'Огірки', 'Засіб для скла']);
    const vals = [...host!.querySelectorAll<HTMLElement>('[data-val]')].map((x) => x.textContent);
    expect(vals).toEqual(['26 г', '3 г', '≈0 г', '']);      // крок Ф2: цілі
    expect(host!.textContent).toContain('від жирного до нежирного');
    expect(host!.querySelector('[data-testid="unit-label"]')!.textContent).toContain('жиру / 100 г');
    // саме сортування не звужує список — лічильник як без фільтра
    expect(host!.querySelector('[data-testid="pantry-meta"]')!.textContent).toBe('4 позиції');
  });

  // ПЕРЕПИСАНО в етапі 2a, свідомо і не мовчки.
  //
  // Тест належав кроку **Ф2**, який звів рядок комори до ОДНОЇ осі позначок —
  // часу, — а безпеку («не їм / не можна») лишив підрядком без знака. Причина
  // тоді була слушна: мітки стояли на одній осі й змагалися за увагу.
  //
  // Редизайн v3 це скасовує двома рішеннями власника від 10.09:
  //   · **Р22** — стан «свіже» перейменований на «Добре»: слово «свіже»
  //     позначає ЗОНУ, і тримати його ще й за станом означало б два значення
  //     одного слова в одному рядку;
  //   · **Р10** — безпека й походження повертаються, але вже ОКРЕМИМИ
  //     каналами праворуч від назви, не на спільній осі. Тобто це не відкат
  //     Ф2, а інше розкладання: Ф2 знімав змагання, v3 його не створює.
  //     У даних Б1 дві мітки мають 17 рядків зі 113 — місце потрібне.
  //
  // Що з Ф2 лишається чинним і перевіряється далі: позначка часу в рядку одна,
  // вона без тексту, і в рядку немає ні «−», ні гліфів.
  it('етап 2a: позначка часу одна, чотири стани, прострочене окремо (Ф2 → Р10, Р22)', async () => {
    await mount();
    const icon = (label: string) => host!.querySelector<HTMLElement>(`[data-batch="${label}"] [data-fresh]`)!.dataset.fresh;
    expect(icon('Пармезан')).toBe('good');       // строку немає
    expect(icon('Куряче філе')).toBe('soon');    // 2 дні
    expect(icon('Огірки')).toBe('check');        // сьогодні
    expect(host!.querySelector('[data-batch="Куряче філе"]')!.textContent).toContain('не їм');
    // єдиний ✕ у рядку — кнопка «Списати»; іконка зліва — svg без тексту
    for (const row of host!.querySelectorAll('[data-batch]')) {
      const marks = [...row.querySelectorAll('[data-fresh]')];
      expect(marks.length).toBe(1);
      expect(marks[0]!.textContent).toBe('');
      const texts = [...row.querySelectorAll('span')].map((x) => x.textContent?.trim());
      expect(texts).not.toContain('−'); expect(texts).not.toContain('✕'); expect(texts).not.toContain('●');
    }
    expect(host!.textContent).not.toContain('СПОЧАТКУ ГОРИТЬ');
  });

  it('крок Ф2: клік по рядку відкриває картку в панелі (store), ✕ не відкриває; пошук без результату — «Показати все»', async () => {
    await mount();
    usePanelStore.setState({ artifacts: [], active: null });
    await click(host!.querySelector<HTMLButtonElement>('[data-batch="Пармезан"] button')!);
    const st = usePanelStore.getState();
    expect(st.artifacts.map((a) => a.key)).toEqual(['batch:Пармезан']);
    expect(st.active).toBe('batch:Пармезан');
    expect(st.artifacts[0]!.kind).toBe('batch');
    // render(key) дає картку з живими даними
    const holder = document.createElement('div'); document.body.appendChild(holder);
    const r2 = createRoot(holder);
    await act(async () => { r2.render(<MemoryRouter>{st.render('batch:Пармезан')}</MemoryRouter>); });
    expect(holder.querySelector('[data-testid="batch-card"]')).not.toBeNull();
    expect(holder.querySelector<HTMLInputElement>('input[aria-label="Назва"]')!.value).toBe('Пармезан');
    await act(async () => { r2.unmount(); }); holder.remove();

    const input = host!.querySelector<HTMLInputElement>('input[aria-label="Знайти в коморі"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'ананас');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host!.querySelector('[data-testid="search-empty"]')!.textContent).toContain('Нічого не знайшли');
    await click([...host!.querySelectorAll<HTMLButtonElement>('[data-testid="search-empty"] button')][0]!);
    expect(names().length).toBe(4);
  });

  it('«стан»: третій приглушений і не вмикається; «тільки» — один; «скинути» повертає групи', async () => {
    await mount();
    await openFilter();
    await click(word('скоро зіпсується'));
    await click(word('з останнього чека'));
    const third = word('не їм / не можна');
    expect(third.disabled).toBe(true);
    expect(third.getAttribute('aria-disabled')).toBe('true');
    await click(third);
    expect(third.getAttribute('aria-pressed')).toBe('false');
    expect(names()).toEqual(['Огірки', 'Куряче філе']);
    expect(host!.querySelector('[data-testid="pantry-meta"]')!.textContent).toBe('2 з 4');

    await click(word('мʼясне'));
    expect(names()).toEqual(['Куряче філе']);
    await click(word('рибне'));
    expect(word('мʼясне').getAttribute('aria-pressed')).toBe('false');
    expect(word('рибне').getAttribute('aria-pressed')).toBe('true');
    // рибне + скоро + чек → порожньо, заголовок по останньому активному в порядку CUTS (рід)
    expect(host!.querySelector('[data-testid="filter-empty"]')!.textContent).toContain('Рибного нема');

    await click(word('скинути'));
    expect(host!.querySelectorAll('[data-zone]').length).toBe(3);
    expect(host!.querySelector('[data-testid="filter-empty"]')).toBeNull();
    expect(word('за місцем').getAttribute('aria-checked')).toBe('true');
  });

  it('пошук по назві категорії працює поверх зрізів', async () => {
    await mount();
    const input = host!.querySelector<HTMLInputElement>('input[aria-label="Знайти в коморі"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'сир');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(names()).toEqual(['Пармезан']);
    expect(host!.querySelector('[data-testid="pantry-meta"]')!.textContent).toBe('1 з 4');
  });
});

describe('2c: хрестик у рядку — списано одразу, причина в плашці, необовʼязкова (⚠3)', () => {
  it('✕ шле PATCH state:depleted БЕЗ причини; кнопка в плашці шле ОКРЕМИЙ PATCH лише з reason', async () => {
    // Роут приймає причину на вже списану партію окремим запитом (2c, шар 1,
    // тест у services/api/tests). Цей — що плашка справді його шле, і саме
    // без state: інакше роут би сприйняв це як повторне списання.
    const sent: { url: string; body: unknown }[] = [];
    const base = fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') sent.push({ url, body: JSON.parse(String(init.body)) });
      if (init?.method === 'PATCH') return new Response(JSON.stringify({ updated: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      return base(url, init);
    }));
    await mount();
    const x = host!.querySelector<HTMLButtonElement>('[data-batch="Огірки"] [aria-label^="Списати"]')!;
    await click(x);
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(sent.at(-1)).toMatchObject({ body: { state: 'depleted' } });
    expect((sent.at(-1)!.body as Record<string, unknown>).reason, 'з ✕ причини нема').toBeUndefined();

    // Плашка є, трійка в ній є, і списання вже сталось.
    const bar = host!.querySelector('[role="status"]')!;
    expect(bar.textContent).toContain('Списано');
    const reasons = [...bar.querySelectorAll<HTMLButtonElement>('[data-reason]')].map((b) => b.dataset.reason);
    expect(reasons).toEqual(['eaten', 'spoiled', 'removed']);

    await click(bar.querySelector<HTMLButtonElement>('[data-reason="spoiled"]')!);
    const last = sent.at(-1)!;
    expect(last.url).toMatch(/\/v1\/pantry\//);
    expect(last.body).toEqual({ reason: 'spoiled' });
    // Названа причина показана, трійка сховалась, «Повернути» лишилось.
    expect(bar.querySelectorAll('[data-reason]').length).toBe(0);
    expect(bar.textContent).toContain('зіпсувалось');
    expect(bar.textContent).toContain('Повернути');
  });

  it('не натиснули — причина не надсилається: метрика порожня, не вигадана', async () => {
    const sent: unknown[] = [];
    const base = fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') { sent.push(JSON.parse(String(init.body))); return new Response('{"updated":true}', { status: 200, headers: { 'content-type': 'application/json' } }); }
      return base(url, init);
    }));
    await mount();
    await click(host!.querySelector<HTMLButtonElement>('[data-batch="Огірки"] [aria-label^="Списати"]')!);
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(sent.some((b) => (b as { reason?: string }).reason)).toBe(false);
  });
});
