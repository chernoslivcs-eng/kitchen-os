// Строк «після відкриття» — v2 (21.09): колонка «відкрите» тієї самої таблиці, для
// зони, де партія лежить. Тег shelf_open_days від моделі — пріоритет над таблицею.
import { describe, it, expect } from 'vitest';
import { shelfOpenDays, openDaysFor } from '../shelf-life.js';
import { effectiveExpiry } from '../pantry-view.js';
import { resolveLabelToKey } from '@kitchen/catalog';

const key = (l: string) => resolveLabelToKey(l);
const D = 86_400_000;

describe('shelfOpenDays за таблицею', () => {
  const cases: [string, 'fridge' | 'dry' | 'drinks', number | null][] = [
    ['гірчиця', 'fridge', 180], ['кетчуп', 'fridge', 60], ['майонез', 'fridge', 45],
    ['оливки зелені', 'fridge', 30], ['тунець консервований', 'fridge', 3],
    ['вино біле сухе', 'fridge', 14], ['пиво світле', 'fridge', 1], ['сік апельсиновий', 'fridge', 5],
    ['сіль', 'dry', null], ['олія соняшникова', 'dry', 90], ['крупа гречана', 'dry', 365],
  ];
  for (const [label, zone, days] of cases) {
    it(`${label} у ${zone} → ${days ?? 'нема'}`, () => { expect(shelfOpenDays(key(label), zone)).toBe(days); });
  }
  it('без ключа — null; консерва відкрита на полиці — null (зона не для цього)', () => {
    expect(shelfOpenDays(null, 'fridge')).toBeNull();
    expect(shelfOpenDays(key('тунець консервований'), 'dry')).toBeNull();
  });
});

describe('openDaysFor: тег моделі важить більше за таблицю', () => {
  it('тег є — беремо тег; тегу нема — таблиця; нема обох — null', () => {
    const tuna = key('тунець консервований')!;
    expect(openDaysFor({ best_before_opened_days: 7, catalog_key: tuna, zone: 'fridge' })).toBe(7);
    expect(openDaysFor({ best_before_opened_days: null, catalog_key: tuna, zone: 'fridge' })).toBe(3);
    expect(openDaysFor({ best_before_opened_days: null, catalog_key: key('сіль'), zone: 'spices' })).toBeNull();
    expect(openDaysFor({ best_before_opened_days: null, catalog_key: null, zone: 'fridge' })).toBeNull();
  });
});

describe('effectiveExpiry: відкрите живе за колонкою «відкрите»', () => {
  const tuna = key('тунець консервований')!;
  const base = { expires_at: null, added_at: '2026-09-01T00:00:00.000Z', zone: 'fridge' as const, best_before_opened_days: null };
  it('запечатана консерва в холодильнику — числа нема (клітинки нема); відкрита — 3 дні від opened_at', () => {
    expect(effectiveExpiry({ ...base, state: 'sealed', opened_at: null }, tuna)).toBeNull();
    expect(effectiveExpiry({ ...base, state: 'opened', opened_at: '2026-09-10T00:00:00.000Z' }, tuna)).toBe(new Date(Date.parse('2026-09-10T00:00:00.000Z') + 3 * D).toISOString());
  });
  it('тег моделі важить більше за таблицю', () => {
    expect(effectiveExpiry({ ...base, best_before_opened_days: 10, state: 'opened', opened_at: '2026-09-10T00:00:00.000Z' }, tuna)).toBe(new Date(Date.parse('2026-09-10T00:00:00.000Z') + 10 * D).toISOString());
  });
  it('партія, створена одразу відкритою (opened_at нема), — відлік від дня додавання', () => {
    expect(effectiveExpiry({ ...base, state: 'opened', opened_at: null }, tuna)).toBe(new Date(Date.parse(base.added_at) + 3 * D).toISOString());
  });
  it('відкриття не подовжує: молоко додане 01.09 (10 дн), відкрите 09.09 (3 дн) — менше з двох', () => {
    const milk = key('молоко коровʼяче 2.5%')!;
    expect(effectiveExpiry({ ...base, state: 'opened', opened_at: '2026-09-09T00:00:00.000Z' }, milk)).toBe(new Date(Date.parse(base.added_at) + 10 * D).toISOString());
  });
  it('відкрите без строку після відкриття (сіль) — як запечатане: не псується', () => {
    const k = key('сіль');
    expect(effectiveExpiry({ ...base, zone: 'spices', state: 'opened', opened_at: '2026-09-10T00:00:00.000Z' }, k)).toBeNull();
  });
  it('записаний expires_at важить над усім', () => {
    expect(effectiveExpiry({ ...base, expires_at: '2026-12-01T00:00:00.000Z', state: 'opened', opened_at: '2026-09-10T00:00:00.000Z' }, tuna)).toBe('2026-12-01T00:00:00.000Z');
  });
});
