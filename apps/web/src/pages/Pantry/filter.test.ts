// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { applyFilter, toggleKind, toggleState, resetFilter, stateFull, freshness, INITIAL, shortDate, type FilterState } from './filter';
import type { PantryBatch } from '../../api';

// Раунд 5, крок Ф1: логіка фільтра зі спеки дизайну.

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

// Етап 1.6 (рішення Р20): капс знято. Він був вписаний не лише в CSS, а й
// у самі рядки — тому лічильник тепер «6 позицій», а не «6 ПОЗИЦІЙ».
// Тест переписаний свідомо, а не видалений: він і далі стежить за формою
// лічильника, просто форма змінилась разом із каноном.
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
    // Етап 2a: пріоритету більше НЕМА — і це вся суть трьох каналів. Раніше
    // «не їм» перебивало строк, бо ділило з ним один підрядок; тепер обидва
    // видні одночасно, кожен у своєму слоті.
    expect(v.list[0]!.safety).toBe('не їм');
    expect(v.list[0]!.time).toBe('≈ ще 2 дн');
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
    expect(v.meta).toBe('6 позицій');
  });
  it('крок Ф2: саме сортування без зрізів не звужує список — лічильник без «з»', () => {
    expect(applyFilter(ITEMS, st({ sort: 'fat' }), ctx).meta).toBe('6 позицій');
    expect(applyFilter(ITEMS, st({ sort: 'fat', cuts: ['meat'] }), ctx).meta).toBe('2 з 6');
    expect(applyFilter(ITEMS, st({ q: 'сир' }), ctx).meta).toBe('1 з 6');
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
    expect(v.meta).toBe('1 з 6');
  });
  // ПЕРЕПИСАНО в етапі 2a. Підрядок «чек · дата» був СПОСОБОМ показати
  // походження в каналі, який ділився з безпекою й часом, — і тому зʼявлявся
  // лише за активного зрізу «з останнього чека» й лише коли інші дві осі
  // молчали. Рішення Р10 дало походженню власний слот: тепер воно видне
  // ЗАВЖДИ і не залежить ні від фільтра, ні від сортування.
  it('етап 2a: походження — свій слот, видне завжди (Р10)', () => {
    const v = applyFilter(ITEMS, st({ sort: 'fat', cuts: ['receipt'] }), ctx);
    expect(v.list.find((r) => r.name === 'Огірки')!.origin).toBe('receipt');
    // Сортування за датою більше нічого не глушить.
    const byDate = applyFilter(ITEMS, st({ sort: 'added', cuts: ['receipt'] }), ctx);
    expect(byDate.list.find((r) => r.name === 'Огірки')!.origin).toBe('receipt');
  });
  // ПЕРЕПИСАНО в етапі 2a, свідомо. Тест належав кроку Ф2, і фіксував дві
  // речі, які редизайн v3 змінює:
  //   1. `freshness(-3) === 'check'` — прострочене й сьогоднішнє були одним
  //      станом. Рішення Р3: станів чотири, `overdue` окремо. Підстава — 10
  //      прострочених зі 113 позицій у даних Б1 бачились як «сьогодні»;
  //   2. `'fresh'` як імʼя стану — рішення Р22 віддає слово «свіже» ЗОНІ, і
  //      стан тепер `'good'` («Добре»).
  // Друга половина твердження Ф2 — «не їм / не можна» тільки підрядком —
  // лишається чинною тут, але її скасовує рішення Р10 (два слоти в рядку);
  // це робота наступного кроку 2a, і тест на неї переписуватиметься окремо.
  it('етап 2a: стан рядка — чотири за days, прострочене окремо (Р3, Р22)', () => {
    expect(freshness(null)).toBe('good');
    expect(freshness(9)).toBe('good');
    expect(freshness(6)).toBe('good');
    expect(freshness(5)).toBe('soon');
    expect(freshness(1)).toBe('soon');
    expect(freshness(0)).toBe('check');
    expect(freshness(-3)).toBe('overdue');
    const v = applyFilter(ITEMS, st({ sort: 'kcal' }), ctx);
    const m = Object.fromEntries(v.list.map((r) => [r.name, r.fresh]));
    expect(m['Куряче філе']).toBe('soon');
    expect(m['Пармезан']).toBe('good');
    expect(v.list.find((r) => r.name === 'Арахісова паста')!.safety).toBe('не можна');
    expect(v.list.find((r) => r.name === 'Куряче філе')!.safety).toBe('не їм');
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
    expect(applyFilter(ITEMS, st({ q: 'сир' }), ctx).meta).toBe('1 з 6');
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

describe('позиція без каталожного ключа — 17% комори', () => {
  it('шкали немає, строк не показується, число зони не видається за знання', () => {
    // Виміряно на живому засіві 11.09: шість позицій, заведених рукою, дістали
    // `catalog_key: null` і числа з таблиці зон — «Куряче філе» 21 день замість
    // двох, «Сіль» 1095. Впевнене «≈ ще 21 дн» на сирому мʼясі гірше за тиху
    // позначку.
    const noKey = b('Щось невідоме', { catalog_key: null, days: 21 });
    // Плаский порядок, бо `list` наповнюється лише поза групуванням за зонами.
    const v = applyFilter([noKey], st({ sort: 'fat' }), ctx);
    expect(v.list[0]!.scale).toBe(false);
    expect(v.list[0]!.time).toBe('без категорії');
  });
});

describe('тон часу без шкали', () => {
  it('«без категорії» тихе навіть на простроченій даті', () => {
    // Виміряно очима 11.09: позиція без ключа з days=-9 світилася червоним
    // «без категорії» — тобто ми не довіряли числу, але фарбували тривогою.
    const v = applyFilter([b('Помідори', { catalog_key: null, days: -9 })], st({ sort: 'fat' }), ctx);
    expect(v.list[0]!.time).toBe('без категорії');
    expect(v.list[0]!.timeTone).toBe('dim');
  });
});

describe('зріз «скоро зіпсується» і прострочене', () => {
  it('прострочене у зріз потрапляє — воно не «вже не наша справа»', () => {
    const items = [
      b('Прострочене', { days: -9 }),
      b('Добігає', { days: 2 }),
      b('Добре', { days: 30 }),
    ];
    const v = applyFilter(items, st({ sort: 'fat', cuts: ['soon'] }), ctx);
    expect(v.list.map((r) => r.name).sort()).toEqual(['Добігає', 'Прострочене']);
  });

  it('позиція без ключа у зріз НЕ потрапляє, хоч число в неї є', () => {
    // Інакше фільтр обіцяв би знання, якого рядок не показує: у списку
    // «скоро зіпсується» стояв би рядок зі словом «без категорії».
    const noKey = b('Невідоме', { catalog_key: null, days: 1 });
    const v = applyFilter([noKey], st({ sort: 'fat', cuts: ['soon'] }), ctx);
    expect(v.list).toEqual([]);
  });
});

describe('порожній стан фільтра роду', () => {
  it('називає позиції без категорії — вони для родів невидимі', () => {
    // PLAN §2: досі це було мовчазне зникнення. Людина ставила «мʼясне»,
    // бачила «Порожньо» і не мала звідки знати, що частина комори просто не
    // має роду. У проді таких 19 зі 113.
    const items = [b('Невідоме А', { catalog_key: null }), b('Невідоме Б', { catalog_key: null })];
    const v = applyFilter(items, st({ sort: 'fat', cuts: ['meat'] }), ctx);
    expect(v.empty).toBe(true);
    expect(v.emptyText).toContain('немає категорії');
  });

  it('коли без категорії лише частина — каже числом', () => {
    const items = [b('Невідоме', { catalog_key: null }), b('Молоко', { cat: 'молочне' })];
    const v = applyFilter(items, st({ sort: 'fat', cuts: ['meat'] }), ctx);
    expect(v.emptyText).toContain('1 позиція без категорії');
  });

  it('без фільтра роду причина не змінилась', () => {
    const v = applyFilter([b('Молоко', { days: 30 })], st({ sort: 'fat', cuts: ['soon'] }), ctx);
    expect(v.emptyText).toBe('Добре.');
  });
});

describe('Р4: точна дата — лише коли її поставила людина', () => {
  it('дата з картки показується словом «до …»', () => {
    const v = applyFilter(
      [b('Сметана', { days: 9, expires_at: '2026-09-20T00:00:00.000Z', expires_source: 'manual' })],
      st({ sort: 'fat' }), ctx,
    );
    expect(v.list[0]!.time).toBe('до 20 вер');
  });

  it('дата, порахована на відкритті, подається як оцінка, не як слово людини', () => {
    // Той самий `expires_at`, інший писач. Розрахунок від `shelf_open_days`
    // не точна дата, і подавати його як «до 20 вер» означало б видавати
    // здогадку за слово людини.
    const v = applyFilter(
      [b('Сметана', { days: 9, expires_at: '2026-09-20T00:00:00.000Z', expires_source: 'category' })],
      st({ sort: 'fat' }), ctx,
    );
    expect(v.list[0]!.time).toBe('≈ ще 9 дн');
  });
});
