// Р161, PR 4: строк «після відкриття» для банок і пляшок без тегу від моделі.
// Комора власника 15.09: 23 позиції без строку — гірчиця, оливки мариновані,
// вино, пиво, тунець, кукурудза — усе «не псується» за запечатаним правилом, а
// відкрите живе днями. Тег shelf_open_days ставить модель; коли його нема —
// каталог за категорією, тими самими константами, що в промпті.
import { describe, it, expect } from 'vitest';
import { shelfOpenDays, openDaysFor, OPEN_SHELF } from '../shelf-life.js';
import { effectiveExpiry } from '../pantry-view.js';
import { resolveLabelToKey } from '@kitchen/catalog';

const key = (l: string) => resolveLabelToKey(l);

describe('shelfOpenDays за категорією каталогу', () => {
  it.each([
    ['гірчиця Верес', OPEN_SHELF.mustard],
    ['кетчуп Heinz', OPEN_SHELF.mustard],
    ['майонез Провансаль', OPEN_SHELF.mustard],
    ['оливки Metro Chef мариновані', OPEN_SHELF.pickles],
    ['тунець Rio Mare', OPEN_SHELF.canned],
    ['кукурудза цукрова консервована', OPEN_SHELF.canned],
    ['вино біле сухе', OPEN_SHELF.wine],
    ['пиво Kronenbourg Blanc', OPEN_SHELF.beer],
    ['сидр яблучний', OPEN_SHELF.wine],
    ['сік апельсиновий', OPEN_SHELF.juice],
    ['соус соєвий', OPEN_SHELF.sauce],
  ])('%s → %s дн', (label, days) => {
    expect(key(label), label).not.toBeNull();
    expect(shelfOpenDays(key(label))).toBe(days);
  });

  it.each(['сіль морська', 'олія соняшникова', 'рис', 'кава мелена', 'чай чорний', 'паприка мелена', 'макарони', 'борошно', 'коріандр', 'лавровий лист', 'шоколад Rioba'])
  ('%s — без строку після відкриття', (label) => {
    expect(shelfOpenDays(key(label))).toBeNull();
  });

  it('без ключа — null', () => {
    expect(shelfOpenDays(null)).toBeNull();
    expect(shelfOpenDays('no_such_key')).toBeNull();
  });
});

describe('openDaysFor: тег моделі важить більше за каталог', () => {
  it('тег є — беремо тег; тегу нема — каталог; нема обох — null', () => {
    const tuna = key('тунець Rio Mare')!;
    expect(openDaysFor({ best_before_opened_days: 7, catalog_key: tuna })).toBe(7);
    expect(openDaysFor({ best_before_opened_days: null, catalog_key: tuna })).toBe(OPEN_SHELF.canned);
    expect(openDaysFor({ best_before_opened_days: null, catalog_key: key('рис') })).toBeNull();
    expect(openDaysFor({ best_before_opened_days: null, catalog_key: null })).toBeNull();
  });
});

describe('effectiveExpiry: відкрита банка без тегу отримує строк з каталогу', () => {
  const tuna = key('тунець Rio Mare')!;
  const base = { expires_at: null, added_at: '2026-09-01T00:00:00.000Z', zone: 'dry' as const, best_before_opened_days: null };
  it('запечатана консерва — не псується; відкрита — canned днів від opened_at', () => {
    expect(effectiveExpiry({ ...base, state: 'sealed', opened_at: null }, tuna)).toBeNull();
    const opened = effectiveExpiry({ ...base, state: 'opened', opened_at: '2026-09-10T00:00:00.000Z' }, tuna);
    expect(opened).toBe(new Date(Date.parse('2026-09-10T00:00:00.000Z') + OPEN_SHELF.canned * 86_400_000).toISOString());
  });
  it('тег моделі важить більше за каталог', () => {
    const opened = effectiveExpiry({ ...base, best_before_opened_days: 10, state: 'opened', opened_at: '2026-09-10T00:00:00.000Z' }, tuna);
    expect(opened).toBe(new Date(Date.parse('2026-09-10T00:00:00.000Z') + 10 * 86_400_000).toISOString());
  });
  it('відкрите без строку після відкриття (спеції) — як і було', () => {
    const k = key('паприка мелена');
    const sealed = effectiveExpiry({ ...base, state: 'sealed', opened_at: null }, k);
    expect(effectiveExpiry({ ...base, state: 'opened', opened_at: '2026-09-10T00:00:00.000Z' }, k)).toBe(sealed);
  });
  it('записаний expires_at важить над усім', () => {
    expect(effectiveExpiry({ ...base, expires_at: '2026-12-01T00:00:00.000Z', state: 'opened', opened_at: '2026-09-10T00:00:00.000Z' }, tuna)).toBe('2026-12-01T00:00:00.000Z');
  });
});
