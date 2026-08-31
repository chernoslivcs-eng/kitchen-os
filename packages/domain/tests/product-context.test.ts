// Черга Д (№2): серіалізація комори знає про «продукт дому».
// 1) вік партії (added_at) видимий моделі;
// 2) «вжити до» без точної дати — ПРИБЛИЗНО з shelf_open_days тегів (тільки
//    для відкритої партії), точний «!Nдн» лишається за expires_at;
// 3) подвійний алерген-захист: мітка ⚠ ставиться за коренем У НАЗВІ АБО за
//    тегом allergens продукту — «камбоцола» без слова «молоко» теж ловиться.

import { describe, it, expect } from 'vitest';
import { serializePantry, maskHistoryQuantities, type PantryBatch, type Profile, type HouseholdProduct } from '../index.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-08-31T12:00:00Z');

function batch(patch: Partial<PantryBatch>): PantryBatch {
  return {
    id: 'b1', household_id: 'h1', catalog_key: null, label: 'щось', zone: 'fridge',
    value: 100, unit: 'g', state: 'sealed', opened_at: null, expires_at: null,
    best_before_opened_days: null, added_at: new Date(NOW - DAY).toISOString(),
    depleted_at: null, confidence: 1, provenance: 'user_statement', staple: false,
    last_by: null, last_action: null, product_id: null, ...patch,
  };
}

function product(patch: Partial<HouseholdProduct>): HouseholdProduct {
  return {
    id: 'p1', household_id: 'h1', product: 'камбоцола', brand: null, variant: null,
    unit: 'g', pack_size: null, tags: {}, catalog_key: null,
    created_at: new Date(NOW).toISOString(), ...patch,
  };
}

describe('serializePantry × продукт дому', () => {
  it('вік партії видно: «дод.Nдн»', () => {
    const out = serializePantry(
      [batch({ label: 'сир', added_at: new Date(NOW - 5 * DAY).toISOString() })],
      null, NOW, [], false, 'none',
    );
    expect(out).toContain('дод.5дн');
  });

  it('свіжа партія (до 2 днів) без вікового маркера', () => {
    const out = serializePantry([batch({ label: 'сир' })], null, NOW, [], false, 'none');
    expect(out).not.toContain('дод.');
  });

  it('відкрита партія без expires_at → «~строк≈» із shelf_open_days тегів', () => {
    const prod = product({ tags: { shelf_open_days: 7 } });
    const b = batch({
      label: 'камбоцола', product_id: 'p1', state: 'opened',
      opened_at: new Date(NOW - 5 * DAY).toISOString(),
    });
    const out = serializePantry([b], null, NOW, [], false, 'none', 60, [prod]);
    expect(out).toContain('~строк≈2дн');
    expect(out).not.toContain('!2дн');       // приблизне ≠ точне
  });

  it('expires_at лишається точним «!Nдн», без «~строк»', () => {
    const b = batch({ label: 'сметана', expires_at: new Date(NOW + 2 * DAY).toISOString() });
    const out = serializePantry([b], null, NOW, [], false, 'none');
    expect(out).toContain('!2дн');
    expect(out).not.toContain('~строк');
  });

  it('алерген ловиться ЗА ТЕГОМ продукту, коли в назві кореня нема', () => {
    const p: Profile = { user_id: 'u1', allergies: ['молоко'], wishes: [], antipatterns: [], equipment: {} };
    const prod = product({ tags: { allergens: ['молоко'] } });
    const b = batch({ label: 'камбоцола', product_id: 'p1' });
    const out = serializePantry([b], p, NOW, [], false, 'none', 60, [prod]);
    expect(out).toContain('⚠АЛЕРГЕН');
    // без продуктів — мітки нема (старе поведінка за коренем у назві)
    const bare = serializePantry([b], p, NOW, [], false, 'none');
    expect(bare).not.toContain('⚠АЛЕРГЕН');
  });
});

// Пул-3: запито-залежний відбір у кеп. Яруси: ⚠ завжди → згадане в розмові →
// термінові → квота залежаним → свіжі. Depleted не існує для промпту ніколи.
describe('serializePantry: кеп і відбір', () => {
  const many = (n: number, patch: (i: number) => Partial<PantryBatch>) =>
    Array.from({ length: n }, (_, i) => batch({ id: `b${i}`, label: `продукт ${i}`, ...patch(i) }));

  it('depleted не потрапляє в контекст ніколи, навіть згаданий', () => {
    const b = batch({ label: 'кімчі', state: 'depleted' });
    const out = serializePantry([b], null, NOW, [], false, 'none', 120, [], 'а де моє кімчі?');
    expect(out).not.toContain('кімчі');
  });

  it('згадана в розмові позиція гарантовано в кепі, навіть найстаріша', () => {
    const bs = [
      batch({ id: 'old', label: 'спагеті', added_at: new Date(NOW - 40 * DAY).toISOString() }),
      ...many(130, (i) => ({ added_at: new Date(NOW - i * 3600_000).toISOString() })),
    ];
    const out = serializePantry(bs, null, NOW, [], false, 'none', 120, [], 'скільки в мене спагеті?');
    expect(out).toContain('спагеті');
  });

  it('квота залежаним: найстаріші активні виживають у кепі при переповненні', () => {
    const bs = [
      batch({ id: 'idle', label: 'маш', added_at: new Date(NOW - 30 * DAY).toISOString() }),
      ...many(130, (i) => ({ added_at: new Date(NOW - i * 3600_000).toISOString() })),
    ];
    const out = serializePantry(bs, null, NOW, [], false, 'none', 120, []);
    expect(out).toContain('маш');
  });

  it('без запиту і квот — поведінка як була: свіжі перемагають, хвіст числом', () => {
    const bs = many(130, (i) => ({ added_at: new Date(NOW - i * DAY).toISOString() }));
    const out = serializePantry(bs, null, NOW, [], false, 'none', 120, []);
    expect(out).toContain('…і ще');
    expect(out).toContain('продукт 0');
  });
});

// Пул-3, pantry-truth: числа-про-запаси в РЕПЛІКАХ ІСТОРІЇ — головний
// конкурент блока [КОМОРА] («купив 500 г» перемагало «100g» з блока чотири
// промпт-ітерації поспіль). Прибираємо спокусу механічно: кількості з
// одиницями ваги/обʼєму/штук маскуються в історичних ходах. Поточна репліка
// не чіпається ніколи.
describe('maskHistoryQuantities', () => {
  it('вирізає кількості з одиницями, лишає текст читабельним', () => {
    expect(maskHistoryQuantities('купив 500 г спагеті і 2 л молока')).toBe('купив спагеті і молока');
    expect(maskHistoryQuantities('додай вершки 200мл і 3 шт яйця')).toBe('додай вершки і яйця');
    expect(maskHistoryQuantities('взяв 1.5 кг борошна')).toBe('взяв борошна');
  });

  it('не чіпає числа без одиниць запасу: порції, час, температуру', () => {
    expect(maskHistoryQuantities('зроби на 4 порції за 20 хвилин при 180 градусах'))
      .toBe('зроби на 4 порції за 20 хвилин при 180 градусах');
    expect(maskHistoryQuantities('вершки 33% і сир 48%')).toBe('вершки 33% і сир 48%');
  });
});
