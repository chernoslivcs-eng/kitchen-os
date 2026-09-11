// @vitest-environment jsdom
import type { DepletedReason } from '../../api';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BatchCard, freshLine, originLine, nutritionLines } from './BatchCard';
import type { PantryBatch } from '../../api';

// Крок Ф2: картка позиції — автозбереження по blur/enter, «Позначити
// відкритою» → opened_at, рядки свіжості/звідки/на 100 г.

const b = (over: Partial<PantryBatch> = {}): PantryBatch => ({
  id: 'b1', household_id: 'h1', catalog_key: 'chicken_fillet', label: 'Куряче філе', zone: 'fridge', value: 500, unit: 'g', state: 'sealed',
  opened_at: null, expires_at: '2026-09-08T00:00:00.000Z', best_before_opened_days: null, added_at: '2026-09-01T00:00:00.000Z', depleted_at: null,
  confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: null,
  cat: 'мʼясо', kcal: 114, fat: 2.62, prot: 22.5, carb: 0, est: false, days: 2, receipt: true, no: 'не їм', added: 5, unit_weight: 180,
  origin: { kind: 'receipt', shop: 'Сільпо', at: '2026-09-03T10:00:00.000Z' }, ...over,
});

describe('рядки картки', () => {
  it('свіжість, звідки, на 100 г і на позицію', () => {
    expect(freshLine(b())).toBe('свіже до 8 вер · ще 2 дні');
    expect(freshLine(b({ days: 0 }))).toBe('свіже до 8 вер · сьогодні');
    expect(freshLine(b({ days: -1 }))).toBe('свіже до 8 вер · термін вийшов');
    // Б3. Досі «без терміну» означало одночасно «не псується» і «ми не знаємо»,
    // і так виглядали 245 із 246 позицій. Після Б1/Б2 незнання зникло:
    // порожній строк — це рішення каталогу, і картка каже саме його.
    expect(freshLine(b({ expires_at: null, days: null }))).toBe('не псується');
    // Розрахований строк не вдає точну дату — так само, як «~строк≈» у
    // промпті проти точного «!Nдн». Дата лишається за тим, що ввела людина.
    expect(freshLine(b({ expires_at: null, days: 5 }))).toBe('≈ще 5 днів');
    expect(freshLine(b({ expires_at: null, days: 0 }))).toBe('≈сьогодні');
    expect(freshLine(b({ expires_at: null, days: -2 }))).toBe('≈термін вийшов');
    expect(originLine(b())).toBe('чек Сільпо · 3 вер');
    expect(originLine(b({ origin: { kind: 'receipt', shop: null, at: '2026-09-03T10:00:00.000Z' } }))).toBe('чек · 3 вер');
    expect(originLine(b({ origin: { kind: 'manual', shop: null, at: '2026-09-01T10:00:00.000Z' } }))).toBe('додано рукою · 1 вер');
    expect(originLine(b({ origin: { kind: 'chat', shop: null, at: '2026-09-01T10:00:00.000Z' } }))).toBe('з розмови');
    expect(nutritionLines(b())).toEqual({ per100: '114 ккал · Б 23 · Ж 3 · В 0', perItem: '570 ккал · Б 113 · Ж 13 · В 0' });
    expect(nutritionLines(b({ est: true, value: 2, unit: 'pcs' }))!.perItem).toBe('≈410 ккал · Б 81 · Ж 9 · В 0');   // 2 × 180 г
    expect(nutritionLines(b({ value: 1, unit: 'pack' }))!.perItem).toBeNull();
    expect(nutritionLines(b({ value: 2, unit: 'pcs', unit_weight: null }))!.perItem).toBeNull();
    expect(nutritionLines(b({ kcal: null }))).toBeNull();
  });
});

describe('BatchCard', () => {
  let host: HTMLDivElement | undefined; let root: Root | undefined;
  let calls: { url: string; method: string; body: unknown }[] = [];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : null });
      return new Response(JSON.stringify({ updated: true, batch: b() }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
  });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); vi.unstubAllGlobals(); });
  async function mount(batch: PantryBatch, over: { onRemove?: (reason: DepletedReason) => Promise<void> } = {}) {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    const onChanged = vi.fn(async () => {});
    await act(async () => { root!.render(<BatchCard batch={batch} product={null} onChanged={onChanged} onRemove={over.onRemove ?? (async () => {})} />); });
    return onChanged;
  }
  const input = (label: string) => host!.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  const setValue = async (el: HTMLInputElement, v: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  it('рендерить рядки; blur на назві й кількості → PATCH без кнопки «Зберегти»', async () => {
    const onChanged = await mount(b());
    expect(host!.textContent).toContain('мʼясо · Холодильник');
    expect(host!.querySelector('[data-testid="fresh-line"]')!.textContent).toContain('свіже до 8 вер · ще 2 дні');
    expect(host!.querySelector('[data-testid="fresh-line"] [data-fresh]')!.getAttribute('data-fresh')).toBe('soon');
    expect(host!.querySelector('[data-testid="origin-line"]')!.textContent).toBe('чек Сільпо · 3 вер');
    expect(host!.querySelector('[data-testid="per-100"]')!.textContent).toBe('114 ккал · Б 23 · Ж 3 · В 0');
    expect(host!.querySelector('[data-testid="per-item"]')!.textContent).toBe('570 ккал · Б 113 · Ж 13 · В 0');
    expect(host!.querySelector('[data-testid="profile-line"]')!.textContent).toBe('не їм');
    expect(host!.textContent).not.toContain('Зберегти');

    await setValue(input('Назва'), 'Філе куряче');
    await act(async () => { input('Назва').focus(); input('Назва').blur(); });
    expect(calls.at(-1)).toMatchObject({ url: '/v1/pantry/b1', method: 'PATCH', body: { label: 'Філе куряче' } });
    await setValue(input('Кількість'), '300');
    await act(async () => { input('Кількість').focus(); input('Кількість').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); input('Кількість').blur(); });
    expect(calls.at(-1)).toMatchObject({ url: '/v1/pantry/b1', method: 'PATCH', body: { value: 300 } });
    expect(onChanged).toHaveBeenCalled();
  });

  it('дата «свіже до» → PATCH expires_at; «без терміну» → null', async () => {
    await mount(b());
    await setValue(input('Свіже до'), '2026-09-12');
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', body: { expires_at: '2026-09-12T00:00:00.000Z' } });
    await act(async () => { [...host!.querySelectorAll('button')].find((x) => x.textContent === 'без терміну')!.click(); });
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', body: { expires_at: null } });
  });

  it('«Позначити відкритою» → PATCH state opened; з opened_at показує «відкрито 6 вер»', async () => {
    await mount(b());
    expect(host!.querySelector('[data-testid="opened-line"]')).toBeNull();
    await act(async () => { [...host!.querySelectorAll('button')].find((x) => x.textContent === 'Позначити відкритою')!.click(); });
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', body: { state: 'opened' } });
    await act(async () => { root!.unmount(); }); host!.remove();
    await mount(b({ state: 'opened', opened_at: '2026-09-06T09:00:00.000Z' }));
    expect(host!.querySelector('[data-testid="opened-line"]')!.textContent).toBe('відкрито 6 вер');
    expect([...host!.querySelectorAll('button')].some((x) => x.textContent === 'Позначити запакованою')).toBe(true);
  });

  describe('2c: списання з картки — причина обовʼязкова (⚠3)', () => {
  it('«Списати» не списує, а розкриває трійку; кожна кнопка передає СВОЮ причину', async () => {
    // Контрактний тест на depleted_reason перевіряє репозиторій і не побачить,
    // якщо кнопка не передасть причину. Цей — що передає, і яку саме.
    const got: string[] = [];
    await mount(b({}), { onRemove: async (reason) => { got.push(reason); } });
    expect(got).toEqual([]);
    const open = [...host!.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Списати')!;
    expect(open, 'кнопка «Списати» є').toBeTruthy();
    await act(async () => { open.click(); });
    // Розкрилась трійка, і списання ще не сталось.
    expect(got).toEqual([]);
    const reasons = [...host!.querySelectorAll<HTMLButtonElement>('[data-reason]')].map((x) => x.dataset.reason);
    expect(reasons).toEqual(['eaten', 'spoiled', 'removed']);
    await act(async () => { host!.querySelector<HTMLButtonElement>('[data-reason="spoiled"]')!.click(); });
    expect(got).toEqual(['spoiled']);
  });

  it('без причини списати не можна — confirm() більше немає', async () => {
    await mount(b({}));
    expect(host!.textContent).not.toContain('Прибрати з комори');
  });
  });
});
