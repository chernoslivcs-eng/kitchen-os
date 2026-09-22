import { describe, it, expect } from 'vitest';
import { isValidLabelSource } from './nutrition.js';

// Етап 2, п.4 (NUTRI-LABELS-REPORT-0922.md, «Ухвалено 22.09»): нове джерело
// label:<домен>@<ISO-дата> — валідатор формату, БЕЗ якого «за півроку не
// буде видно, що саме перевіряли і коли». Рядків із цим джерелом ще нема в
// data/nutrition/base.csv (це відкриває двері для етапу 4) — тут лише формат.
describe('isValidLabelSource: label:<домен>@<ISO-дата>', () => {
  it('валідні', () => {
    expect(isValidLabelSource('label:veres.ua@2026-09-22')).toBe(true);
    expect(isValidLabelSource('label:shop.metro.ua@2026-01-05')).toBe(true);
    expect(isValidLabelSource('label:silpo.ua@2026-12-31')).toBe(true);
  });
  it('без домену/дати, чи не той префікс — невалідні', () => {
    expect(isValidLabelSource('label:@2026-09-22')).toBe(false);
    expect(isValidLabelSource('label:veres.ua')).toBe(false);
    expect(isValidLabelSource('label:veres.ua@')).toBe(false);
    expect(isValidLabelSource('label:veres@2026-09-22')).toBe(false); // домен без крапки/TLD
    expect(isValidLabelSource('veres.ua@2026-09-22')).toBe(false);    // без префікса label:
    expect(isValidLabelSource('usda:171009')).toBe(false);
    expect(isValidLabelSource('estimate')).toBe(false);
  });
  it('дата — справжня календарна (round-trip через Date, ловить «30 лютого»)', () => {
    expect(isValidLabelSource('label:veres.ua@2026-02-30')).toBe(false);
    expect(isValidLabelSource('label:veres.ua@2026-13-01')).toBe(false);
    expect(isValidLabelSource('label:veres.ua@2026-02-28')).toBe(true);
  });
});
