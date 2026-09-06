// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { applyFilter, toggleKind, toggleState, resetFilter, stateFull, freshness, INITIAL, shortDate, type FilterState } from './filter';
import type { PantryBatch } from '../../api';

// Раунд 5, крок Ф1: логіка фільтра зі спеки дизайну.

const b = (label: string, over: Partial<PantryBatch> = {}): PantryBatch => ({
  id: label, household_id: 'h1', catalog_key: null, label, zone: 'fridge', value: 100, unit: 'g', state: 'sealed',
  opened_at: null, expires_at: null, best_before_opened_days: null, added_at: '2026-09-01T00:00:00.000Z', depleted_at: null,
  confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: null,
  cat: null, kcal: null, fat: null, prot: null, carb: null, est: null, days: null, receipt: false, no: null, added: 5, ...over,
});
const ITEMS: PantryBatch[] = [
  b('Пармезан', { cat: 'сири', fat: 25.8, kcal: 392, prot: 35.8, carb: 3.2, est: false }),
  b('Куряче філе', { cat: 'мʼясо', fat: 2.6, kcal: 114, prot: 22.5, carb: 0, est: false, days: 2, receipt: true, no: 'не їм' }),
  b('Стейк рібай', { cat: 'мʼясо', fat: 20, kcal: 250, prot: 17, carb: 0, est: true, zone: 'freezer' }),
  b('Огірки', { cat: 'овочі', fat: 0.1, kcal: 15, prot: 0.7, carb: 3.6, est: false, zone: 'fresh', receipt: true }),
  b('Засіб для скла', { zone: 'dry' }),                       // без каталогу — усе null
  b('Арахісова паста', { cat: 'горіхи й олії', fat: 50, kcal: 600, prot: 25, carb: 20, est: true, no: 'не можна' }),
];
const ctx = { productsById: new Map(), receiptAt: '2026-09-03T10:00:00.000Z' };
const st = (over: Partial<FilterState> = {}): FilterState => ({ ...INITIAL, ...over });

describe('сортування', () => {
  it('за жирністю — спадний порядок, без значення в кінці, оцінка з ≈', () => {
    const v = applyFilter(ITEMS, st({ sort: 'fat' }), ctx);
    expect(v.grouped).toBe(false);
    expect(v.list.map((r) => r.name)).toEqual(['Арахісова паста', 'Пармезан', 'Стейк рібай', 'Куряче філе', 'Огірки', 'Засіб для скла']);
    expect(v.list[0]!.val).toBe('≈50 г');
    expect(v.list[1]!.val).toBe('26 г');    // крок Ф2: цілі
    expect(v.list[4]!.val).toBe('0 г');
    expect(v.list[5]!.val).toBe('');
  });
  it('за свіжістю — без терміну в кінці; підрядок «ще N дн» не дублюється з колонкою', () => {
    const v = applyFilter(ITEMS, st({ sort: 'fresh' }), ctx);
    expect(v.list[0]!.name).toBe('Куряче філе');
    expect(v.list[0]!.val).toBe('2 дн');
    expect(v.list[0]!.valTone).toBe('amber');
    expect(v.list[0]!.sub).toBe('не їм');   // no має пріоритет над «ще N дн»
    expect(v.flatLabel).toBe('найшвидше зіпсується — зверху');
  });
  it('Ф2а: усередині групи — за added_at (новіше зверху), потім за назвою; порядок сервера не впливає', () => {
    const items = [
      b('Сир', { zone: 'fridge', added_at: '2026-09-01T00:00:00.000Z' }),
      b('Айран', { zone: 'fridge', added_at: '2026-09-03T00:00:00.000Z' }),
      b('Бринза', { zone: 'fridge', added_at: '2026-09-03T00:00:00.000Z' }),
      b('Йогурт', { zone: 'fridge', added_at: '2026-09-02T00:00:00.000Z' }),
    ];
    const names = (list: PantryBatch[]) => applyFilter(list, INITIAL, ctx).groups[0]!.items.map((r) => r.name);
    expect(names(items)).toEqual(['Айран', 'Бринза', 'Йогурт', 'Сир']);
    expect(names([...items].reverse())).toEqual(['Айран', 'Бринза', 'Йогурт', 'Сир']);
  });

  it('за місцем — групи за зонами в порядку брифу', () => {
    const v = applyFilter(ITEMS, INITIAL, ctx);
    expect(v.grouped).toBe(true);
    expect(v.groups.map((g) => g.label)).toEqual(['Свіже', 'Холодильник', 'Морозилка', 'Суха шафа']);
    expect(v.dirty).toBe(false);
    expect(v.meta).toBe('6 ПОЗИЦІЙ');
  });
  it('крок Ф2: саме сортування без зрізів не звужує список — лічильник без «з»', () => {
    expect(applyFilter(ITEMS, st({ sort: 'fat' }), ctx).meta).toBe('6 ПОЗИЦІЙ');
    expect(applyFilter(ITEMS, st({ sort: 'fat', cuts: ['meat'] }), ctx).meta).toBe('2 З 6');
    expect(applyFilter(ITEMS, st({ q: 'сир' }), ctx).meta).toBe('1 З 6');
  });
});

describe('зрізи', () => {
  it('«тільки» — один рід: другий замінює перший', () => {
    let s = toggleKind(INITIAL, 'meat');
    expect(s.cuts).toEqual(['meat']);
    s = toggleKind(s, 'veg');
    expect(s.cuts).toEqual(['veg']);
    s = toggleKind(s, 'veg');
    expect(s.cuts).toEqual([]);
  });
  it('«стан» — до двох; третій приглушений і не вмикається; рід не рахується', () => {
    let s = toggleState(toggleKind(INITIAL, 'meat'), 'soon');
    s = toggleState(s, 'receipt');
    expect(s.cuts).toEqual(['meat', 'soon', 'receipt']);
    expect(stateFull(s, 'no')).toBe(true);
    expect(toggleState(s, 'no')).toBe(s);
    expect(applyFilter(ITEMS, s, ctx).states.find((x) => x.key === 'no')?.full).toBe(true);
    s = toggleState(s, 'soon');       // вимкнути активний можна завжди
    expect(stateFull(s, 'no')).toBe(false);
  });
  it('фільтри перетинаються: мʼясне + з останнього чека', () => {
    const v = applyFilter(ITEMS, st({ sort: 'fat', cuts: ['meat', 'receipt'] }), ctx);
    expect(v.list.map((r) => r.name)).toEqual(['Куряче філе']);
    expect(v.meta).toBe('1 З 6');
  });
  it('підрядок «чек · дата» при активному чеку, крім сортування за датою', () => {
    const v = applyFilter(ITEMS, st({ sort: 'fat', cuts: ['receipt'] }), ctx);
    expect(v.list.find((r) => r.name === 'Огірки')!.sub).toBe('чек · 3 вер');
    expect(v.list.find((r) => r.name === 'Огірки')!.subTone).toBe('sage');
    const byDate = applyFilter(ITEMS, st({ sort: 'added', cuts: ['receipt'] }), ctx);
    expect(byDate.list.find((r) => r.name === 'Огірки')!.sub).toBe('');
  });
  it('крок Ф2: іконка — лише свіжість (4 стани за days); «не їм / не можна» — тільки підрядок', () => {
    expect(freshness(null)).toBe('fresh');
    expect(freshness(9)).toBe('fresh');
    expect(freshness(6)).toBe('fresh');
    expect(freshness(5)).toBe('soon');
    expect(freshness(1)).toBe('soon');
    expect(freshness(0)).toBe('check');
    expect(freshness(-3)).toBe('check');
    const v = applyFilter(ITEMS, st({ sort: 'kcal' }), ctx);
    const m = Object.fromEntries(v.list.map((r) => [r.name, r.fresh]));
    expect(m['Куряче філе']).toBe('soon');
    expect(m['Пармезан']).toBe('fresh');
    expect(v.list.find((r) => r.name === 'Арахісова паста')!.sub).toBe('не можна');
    expect(v.list.find((r) => r.name === 'Куряче філе')!.sub).toBe('не їм');
    expect(JSON.stringify(v.list)).not.toMatch(/[−✕]/);
  });
  it('крок Ф2: ккал цілими з «ккал», заголовок і скорочення шкали', () => {
    const v = applyFilter(ITEMS, st({ sort: 'kcal' }), ctx);
    expect(v.list[0]!.val).toBe('≈600 ккал');
    expect(v.unitLabel).toBe('ккал / 100 г');
    const c = applyFilter(ITEMS, st({ sort: 'carb' }), ctx);
    expect(c.unitLabel).toBe('вуглеводів / 100 г');
    expect(c.unitShort).toBe('вугл. / 100 г');
  });
});

describe('пошук, скинути, порожній стан', () => {
  it('пошук — по назві продукту і по назві категорії, поверх зрізів', () => {
    expect(applyFilter(ITEMS, st({ q: 'сир' }), ctx).shown.map((x) => x.label)).toEqual(['Пармезан']);
    expect(applyFilter(ITEMS, st({ q: 'овоч' }), ctx).shown.map((x) => x.label)).toEqual(['Огірки']);
    expect(applyFilter(ITEMS, st({ q: 'мʼяс', cuts: ['receipt'] }), ctx).shown.map((x) => x.label)).toEqual(['Куряче філе']);
    expect(applyFilter(ITEMS, st({ q: 'сир' }), ctx).meta).toBe('1 З 6');
  });
  it('«скинути» повертає «за місцем» без зрізів і групи; пошук не чіпає', () => {
    const s = resetFilter(st({ sort: 'fat', cuts: ['meat', 'soon'], q: 'x' }));
    expect(s).toEqual({ sort: 'zone', cuts: [], q: 'x' });
    expect(applyFilter(ITEMS, { ...s, q: '' }, ctx).grouped).toBe(true);
  });
  it('порожній стан — по ключу останнього активного зрізу; при пошуку не показується', () => {
    const fish = applyFilter(ITEMS, st({ cuts: ['fish'] }), ctx);
    expect(fish.empty).toBe(true);
    expect(fish.emptyTitle).toBe('Рибного нема');
    expect(fish.emptyText).toBe('Можна докупити.');
    // «останній активний» — у порядку CUTS (стан перед родом), як у дизайні
    const two = applyFilter(ITEMS, st({ cuts: ['veg', 'no'] }), ctx);
    expect(two.emptyTitle).toBe('Овочів нема');
    expect(two.emptyText).toBe('Разом ці умови нічого не лишають.');
    expect(applyFilter(ITEMS, st({ cuts: ['fish'], q: 'zzz' }), ctx).empty).toBe(false);
    expect(applyFilter(ITEMS, INITIAL, ctx).empty).toBe(false);
  });
  it('shortDate — «3 вер»', () => {
    expect(shortDate('2026-09-03T10:00:00.000Z')).toBe('3 вер');
    expect(shortDate(null)).toBe('');
  });
});
