// «?домисл.N%» у рядку партії. Аудит 04.09, раунд 2, крок 3.3
// (AUDIT-ROUND-2.md §2): confidence писався в партію (apply.ts) і ніде не
// читався. Лендинг обіцяє «томат · домислено 60%» як перше правило довіри;
// ToV §7 — «схоже на філе, перевір». Мітка в рядку — той самий механізм, що
// ?рід і ⚠АЛЕРГЕН: модель бачить, ЩО саме непевне, а не сумнівається всюди.
//
// Тут лише вимірювання: коли мітка є, коли нема. Що з нею робити — легенда
// блоку [КОМОРА] (динаміка, не префікс) і, згодом, режим auto/confirm.

import { describe, it, expect } from 'vitest';
import { serializePantry, buildKitchenContext, isDoubtful, DOUBT_THRESHOLD } from '../context.js';
import type { PantryBatch } from '../types.js';

let n = 0;
function batch(label: string, over: Partial<PantryBatch> = {}): PantryBatch {
  return {
    id: `b${++n}`, household_id: 'h1', catalog_key: null, label, zone: 'fridge',
    value: 400, unit: 'g', state: 'sealed', opened_at: null, expires_at: null,
    best_before_opened_days: null, added_at: new Date().toISOString(),
    depleted_at: null, confidence: 1, provenance: 'user_statement', staple: false,
    last_by: null, last_action: 'add', product_id: null, ...over,
  };
}

describe('isDoubtful', () => {
  it('поріг: нижче 0.8 — сумнів; 0.8 і вище — ні', () => {
    expect(DOUBT_THRESHOLD).toBe(0.8);
    expect(isDoubtful({ confidence: 0.7, provenance: 'user_statement' })).toBe(true);
    expect(isDoubtful({ confidence: 0.8, provenance: 'user_statement' })).toBe(false);
    expect(isDoubtful({ confidence: 0.9, provenance: 'receipt_line' })).toBe(false);
  });
  it('домислене — сумнів незалежно від числа', () => {
    expect(isDoubtful({ confidence: 0.95, provenance: 'inference' })).toBe(true);
  });
});

describe('«?домисл.» у [КОМОРА]', () => {
  it('s40: «сосиски» з inference 0.7 → ?домисл.70%; «молоко» 0.9 — без мітки', () => {
    const s = serializePantry([
      batch('Сосиски', { confidence: 0.7, provenance: 'inference' }),
      batch('Молоко', { confidence: 0.9 }),
    ], Date.now());
    const [sausage, milk] = s.split('\n');
    expect(sausage).toContain('Сосиски');
    expect(sausage).toContain('?домисл.70%');
    expect(milk).toContain('Молоко');
    expect(milk).not.toContain('?домисл');
  });

  it('confidence 1 (як у стабі й ручному додаванні) — без мітки', () => {
    expect(serializePantry([batch('Спагеті')], Date.now())).not.toContain('?домисл');
  });

  it('легенда блоку пояснює мітку — правило їде разом із даними, не в префіксі', () => {
    const ctx = buildKitchenContext({
      pantry: [batch('Сосиски', { confidence: 0.6, provenance: 'inference' })],
      profile: null, now: new Date(),
    } as never);
    expect(ctx).toContain('«?домисл.N%»');
    expect(ctx).toContain('?домисл.60%');
  });
});
