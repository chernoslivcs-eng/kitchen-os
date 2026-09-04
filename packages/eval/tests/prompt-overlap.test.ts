import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { findOverlaps, newOverlaps, report } from '@kitchen/prompts/lint-overlap';

// Гейт на перетини правил між файлами промпту (packages/prompts/lint-overlap.ts).
// Базова лінія — відомі перетини на момент аудиту 04.09; тест падає лише на
// НОВИЙ файл у наявному маркері. Прибрати рядок із лінії — разом із тим, як
// правило дістало одного власника, не разом із тестом.

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = resolve(HERE, '../../prompts/OVERLAP-BASELINE.json');

describe('перетини правил між файлами промпту', () => {
  const overlaps = findOverlaps();
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8')) as Record<string, string[]>;

  it('жодного нового перетину поза базовою лінією', () => {
    const fresh = newOverlaps(overlaps, baseline);
    expect(fresh, '\n' + report(overlaps.filter((o) => fresh.some((f) => f.marker === o.marker.id)))).toEqual([]);
  });

  it('звіт читається (для очей, не для гейта)', () => {
    expect(report(overlaps)).toContain('##');
  });
});
