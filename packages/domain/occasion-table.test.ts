import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOccasionTable, TABLE_YEARS } from './periods.js';
import { BUILTIN_OCCASIONS } from './occasion-data.js';

// П1: data/occasions/table.json — заморожений вихід тієї самої арифметики,
// що працює в сервері. Розійшлось — хтось змінив довідник і не перебудував
// таблицю (npx tsx scripts/occasions/build-table.ts).
const FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/occasions/table.json');

describe('data/occasions/table.json', () => {
  const doc = JSON.parse(readFileSync(FILE, 'utf-8')) as { years: number[]; entries: unknown[] };

  it('дорівнює обчисленню з довідника', () => {
    expect(doc.years).toEqual([...TABLE_YEARS]);
    expect(doc.entries).toEqual(buildOccasionTable(BUILTIN_OCCASIONS, TABLE_YEARS));
  });

  it('Великдень 2026: 12 квіт. / 5 квіт.; Песах 2026 з 1 квіт.; таблиця без дірок', () => {
    const e = doc.entries as { occasion_id: string; tradition: string | null; year: number; from: string; to: string }[];
    expect(e.find((x) => x.occasion_id === 'easter' && x.tradition === 'orthodox' && x.year === 2026)?.from).toBe('2026-04-12');
    expect(e.find((x) => x.occasion_id === 'easter' && x.tradition === 'catholic' && x.year === 2026)?.from).toBe('2026-04-05');
    expect(e.find((x) => x.occasion_id === 'pesach' && x.year === 2026)?.from).toBe('2026-04-01');
    const ids = new Set(e.map((x) => x.occasion_id));
    for (const id of ids) {
      for (const y of TABLE_YEARS) expect(e.some((x) => x.occasion_id === id && x.year === y), `${id} ${y}`).toBe(true);
    }
    expect(e.every((x) => x.from <= x.to)).toBe(true);
  });
});
