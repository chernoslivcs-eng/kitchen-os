// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { PantryPage } from './Pantry';
import type { PantryBatch } from '../../api';

// Раунд 5, крок Ф1: рейки фільтра на сторінці — «стан» не вмикає третій,
// «скинути» повертає групи, сортування дає плаский список з колонкою.

const b = (label: string, over: Partial<PantryBatch> = {}): PantryBatch => ({
  id: label, household_id: 'h1', catalog_key: null, label, zone: 'fridge', value: 100, unit: 'g', state: 'sealed',
  opened_at: null, expires_at: null, best_before_opened_days: null, added_at: '2026-09-01T00:00:00.000Z', depleted_at: null,
  confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: null,
  cat: null, kcal: null, fat: null, prot: null, carb: null, est: null, days: null, receipt: false, no: null, added: 5, ...over,
});
const ITEMS = [
  b('Пармезан', { cat: 'сири', fat: 25.8, kcal: 392, prot: 35.8, carb: 3.2, est: false }),
  b('Куряче філе', { cat: 'мʼясо', fat: 2.6, kcal: 114, prot: 22.5, carb: 0, est: false, days: 2, receipt: true }),
  b('Огірки', { cat: 'овочі', fat: 0.1, kcal: 15, prot: 0.7, carb: 3.6, est: true, zone: 'fresh', receipt: true }),
  b('Засіб для скла', { zone: 'dry' }),
];

let host: HTMLDivElement | undefined; let root: Root | undefined;
beforeEach(() => {
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
const word = (label: string) => [...host!.querySelectorAll<HTMLButtonElement>('[data-testid="filter-rails"] button')].find((x) => x.textContent === label)!;
const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); };
const names = () => [...host!.querySelectorAll<HTMLElement>('[data-batch]')].map((x) => x.dataset.batch);

describe('PantryPage · фільтр', () => {
  it('за замовчуванням — групи за місцем і лічильник «N ПОЗИЦІЙ»; за жирністю — плаский список спадно, без значення в кінці', async () => {
    await mount();
    expect(host!.querySelectorAll('[data-zone]').length).toBe(3);
    expect(host!.querySelector('[data-testid="pantry-meta"]')!.textContent).toBe('4 ПОЗИЦІЇ');
    await click(word('за жирністю'));
    expect(host!.querySelectorAll('[data-zone]').length).toBe(0);
    expect(host!.querySelector('[data-testid="flat-list"]')).not.toBeNull();
    expect(names()).toEqual(['Пармезан', 'Куряче філе', 'Огірки', 'Засіб для скла']);
    const vals = [...host!.querySelectorAll<HTMLElement>('[data-val]')].map((x) => x.textContent);
    expect(vals).toEqual(['25.8 г', '2.6 г', '≈0.1 г', '']);
    expect(host!.textContent).toContain('від жирного до нежирного');
    expect(host!.textContent).toContain('жиру / 100 г');
  });

  it('«стан»: третій приглушений і не вмикається; «тільки» — один; «скинути» повертає групи', async () => {
    await mount();
    await click(word('скоро зіпсується'));
    await click(word('з останнього чека'));
    const third = word('не їм / не можна');
    expect(third.disabled).toBe(true);
    expect(third.getAttribute('aria-disabled')).toBe('true');
    await click(third);
    expect(third.getAttribute('aria-pressed')).toBe('false');
    expect(names()).toEqual(['Куряче філе']);
    expect(host!.querySelector('[data-testid="pantry-meta"]')!.textContent).toBe('1 З 4');

    await click(word('мʼясне'));
    await click(word('овочеве'));
    expect(word('мʼясне').getAttribute('aria-pressed')).toBe('false');
    expect(word('овочеве').getAttribute('aria-pressed')).toBe('true');
    // овочеве + скоро + чек → порожньо, заголовок по останньому активному в порядку CUTS (рід)
    expect(host!.querySelector('[data-testid="filter-empty"]')!.textContent).toContain('Овочів нема');

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
    expect(host!.querySelector('[data-testid="pantry-meta"]')!.textContent).toBe('1 З 4');
  });
});
