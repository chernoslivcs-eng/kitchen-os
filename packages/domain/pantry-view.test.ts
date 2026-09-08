import { describe, it, expect } from 'vitest';
import { topCategory, daysLeft, pantryItemView, pantryVetoRows, vetoMarkOf } from './pantry-view.js';
import { serializePantry } from './context.js';
import { buildVetoIndex } from './veto-index.js';
import { BY_KEY } from '@kitchen/catalog/seed';
import type { PantryBatch } from './types.js';

// Раунд 5, крок Ф1: поля позиції для фільтра комори.

const NOW = new Date('2026-09-06T12:00:00Z').getTime();
const batch = (label: string, over: Partial<PantryBatch> = {}): PantryBatch => ({
  id: label, household_id: 'h1', catalog_key: null, label, zone: 'fridge', value: 100, unit: 'g', state: 'sealed',
  opened_at: null, expires_at: null, best_before_opened_days: null, added_at: new Date(NOW - 5 * 86_400_000).toISOString(),
  depleted_at: null, confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: null, ...over,
});

describe('topCategory', () => {
  it('за токенами categories, перший за пріоритетом', () => {
    expect(topCategory(BY_KEY.get('chicken_fillet')!.categories)).toBe('мʼясо');
    expect(topCategory(BY_KEY.get('parmesan')!.categories)).toBe('сири');
    expect(topCategory(BY_KEY.get('eggs_chicken')!.categories)).toBe('яйця');
    expect(topCategory(['бланк', 'пшеничне пиво', 'пиво', 'алкоголь', 'напої', 'рослинне'])).toBe('алкоголь');
    expect(topCategory(['зелений горошок', 'горошок', 'бобові', 'овочі', 'рослинне'])).toBe('зелень і бобові');
    expect(topCategory(['тунець в олії', 'тунець', 'риба', 'консерви', 'тваринне'])).toBe('консерви');
    expect(topCategory(['рідина для посуду', 'побутова хімія', 'нехарчове'])).toBe('побутове');
    expect(topCategory(['щось', 'дивне'])).toBeNull();
  });
});

describe('daysLeft', () => {
  it('днів до expires_at, null без терміну', () => {
    expect(daysLeft(new Date(NOW + 3 * 86_400_000).toISOString(), NOW)).toBe(3);
    expect(daysLeft(new Date(NOW - 86_400_000).toISOString(), NOW)).toBe(-1);
    expect(daysLeft(null, NOW)).toBeNull();
  });
});

describe('no збігається з ⚠ у промпті на одному семплі', () => {
  const index = [...buildVetoIndex('u1', 'no', 'мʼяса'), ...buildVetoIndex('u1', 'ban', 'арахіс')];
  const bs = [batch('Стейк рібай'), batch('Арахісова паста'), batch('Картопля'), batch('Куряче філе', { catalog_key: 'chicken_fillet' })];
  it('кожен рядок: не можна ↔ ⚠АЛЕРГЕН, не їм ↔ ⚠НЕ ЇСТЬ, null ↔ без мітки', () => {
    const prompt = serializePantry(bs, NOW, false, 'none', 120, [], '', index);
    for (const b of bs) {
      const line = prompt.split('\n').find((l) => l.startsWith(b.label))!;
      const no = vetoMarkOf(pantryVetoRows(b, b.catalog_key, index));
      expect(line.includes('⚠АЛЕРГЕН'), `${b.label}: ${line}`).toBe(no === 'не можна');
      expect(line.includes('⚠НЕ ЇСТЬ'), `${b.label}: ${line}`).toBe(no === 'не їм');
    }
    expect(vetoMarkOf(pantryVetoRows(bs[0]!, null, index))).toBe('не їм');
    expect(vetoMarkOf(pantryVetoRows(bs[1]!, null, index))).toBe('не можна');
    expect(vetoMarkOf(pantryVetoRows(bs[2]!, null, index))).toBeNull();
    expect(vetoMarkOf(pantryVetoRows(bs[3]!, 'chicken_fillet', index))).toBe('не їм');
  });
});

describe('pantryItemView', () => {
  it('усі поля з каталогу, терміну, чека й індексу', () => {
    const b = batch('Куряче філе', { catalog_key: 'chicken_fillet', expires_at: new Date(NOW + 2 * 86_400_000).toISOString() });
    const v = pantryItemView(b, undefined, buildVetoIndex('u1', 'no', 'мʼяса'), new Set([b.id]), NOW);
    expect(v).toEqual({ cat: 'мʼясо', kcal: 114, fat: 2.62, prot: 22.5, carb: 0, est: false, days: 2, receipt: true, no: 'не їм', added: 5, unit_weight: 180 });
  });
  it('невідомий продукт — усе null, receipt false', () => {
    const v = pantryItemView(batch('Щось xyz'), undefined, [], new Set(), NOW);
    expect(v).toEqual({ cat: null, kcal: null, fat: null, prot: null, carb: null, est: null, days: null, receipt: false, no: null, added: 5, unit_weight: null });
  });
});
