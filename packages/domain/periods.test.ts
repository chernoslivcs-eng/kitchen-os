import { describe, it, expect } from 'vitest';
import {
  subscriptionDefault, subscribedRows, subscribedTraditions, occasionSet, nowItems, serializeNow,
  periodVetoRows, buildOccasionTable, findOccasionByTitle, eventWindow, ruleFromDates, nextWindow, occasionWhat,
} from './periods.js';
import { activeOccasions } from './occasions.js';
import { BUILTIN_OCCASIONS, isWindowRow } from './occasion-data.js';
import { matchVeto } from './veto.js';
import type { HouseholdEventRow } from './types.js';

// Раунд 5, крок П1: довідник крізь підписку, записи дому, [ЗАРАЗ], вето, таблиця.

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12);

const event = (over: Partial<HouseholdEventRow>): HouseholdEventRow => ({
  id: 'aaaaaaaa-0000-4000-8000-000000000001', household_id: 'h1', kind: 'diet', title: 'білкова', note: null,
  rule: { t: 'once', at: '2026-09-01', days: 30 }, force: 'hint', restricts: null,
  from: '2026-09-01', to: '2026-09-30', rule_text: 'більше білка, менше вуглеводів', strict: false,
  buy: [], recipe_id: null, servings: null, supply: null, created_by: 'u1', source: 'chat',
  expires_at: null, done_at: null, created_at: '2026-08-31T10:00:00.000Z', ...over,
});

describe('довідник', () => {
  it('31 сезон, традиції по наборах, 1 редакційний', () => {
    const by = (t: string) => BUILTIN_OCCASIONS.filter((r) => r.type === t).length;
    expect(by('season')).toBe(31);
    expect(by('editorial')).toBe(1);
    const trad = (t: string) => BUILTIN_OCCASIONS.filter((r) => r.tradition === t).length;
    expect(trad('jewish')).toBe(7);
    expect(trad('islamic')).toBe(3);
    expect(trad('secular')).toBe(7);
    expect(trad('catholic')).toBe(5);
    expect(trad('orthodox')).toBe(4);
    // Великдень без традиції — в обох християнських наборах.
    expect(occasionSet(BUILTIN_OCCASIONS, 'orthodox').map((r) => r.id)).toContain('easter');
    expect(occasionSet(BUILTIN_OCCASIONS, 'catholic').map((r) => r.id)).toContain('easter');
    expect(occasionSet(BUILTIN_OCCASIONS, 'seasons')).toHaveLength(32);
    // Жодних дублів id.
    expect(new Set(BUILTIN_OCCASIONS.map((r) => r.id)).size).toBe(BUILTIN_OCCASIONS.length);
  });
});

describe('підписка: дефолти без рядка', () => {
  it('сезон і редакційне увімкнені, свято традиції вимкнене', () => {
    expect(subscriptionDefault({ type: 'season' })).toBe(true);
    expect(subscriptionDefault({ type: 'editorial' })).toBe(true);
    expect(subscriptionDefault({ type: 'tradition' })).toBe(false);
    const rows = subscribedRows(BUILTIN_OCCASIONS, []);
    expect(rows.every((r) => r.type !== 'tradition')).toBe(true);
    expect(rows.map((r) => r.id)).toContain('melon');
  });

  it('відписка від сезону і підписка на свято — рядки-відхилення', () => {
    const rows = subscribedRows(BUILTIN_OCCASIONS, [{ occasion_id: 'melon', enabled: false }, { occasion_id: 'advent', enabled: true }]);
    expect(rows.map((r) => r.id)).not.toContain('melon');
    expect(rows.map((r) => r.id)).toContain('advent');
    expect(subscribedTraditions(rows)).toEqual(['catholic']);
  });

  it('відписка від кавунів: activeOccasions, «зараз» і [ЗАРАЗ] без кавунів', () => {
    const on = subscribedRows(BUILTIN_OCCASIONS, []);
    const off = subscribedRows(BUILTIN_OCCASIONS, [{ occasion_id: 'melon', enabled: false }]);
    const aug = d(2026, 8, 20);
    expect(activeOccasions(aug, [], on).map((o) => o.id)).toContain('melon');
    expect(activeOccasions(aug, [], off).map((o) => o.id)).not.toContain('melon');
    expect(nowItems(off, [], aug).map((i) => i.occasion_id)).not.toContain('melon');
    expect(serializeNow(off, [], aug)).not.toContain('кавуни');
    expect(serializeNow(on, [], aug)).toContain('кавуни');
  });

  it('підписка catholic → Адвент є в грудні', () => {
    const rows = subscribedRows(BUILTIN_OCCASIONS, occasionSet(BUILTIN_OCCASIONS, 'catholic').map((r) => ({ occasion_id: r.id, enabled: true })));
    expect(nowItems(rows, [], d(2026, 12, 10)).map((i) => i.title)).toContain('Адвент');
    expect(nowItems(subscribedRows(BUILTIN_OCCASIONS, []), [], d(2026, 12, 10)).map((i) => i.title)).not.toContain('Адвент');
  });
});

describe('«зараз» одним контрактом', () => {
  it('довідник і записи дому одним списком, суворе першим', () => {
    const rows = subscribedRows(BUILTIN_OCCASIONS, occasionSet(BUILTIN_OCCASIONS, 'orthodox').map((r) => ({ occasion_id: r.id, enabled: true })));
    const guests = event({ id: 'bbbbbbbb-0000-4000-8000-000000000002', kind: 'custom', title: 'гості', rule: { t: 'once', at: '2026-03-05' }, from: '2026-03-05', to: '2026-03-05', rule_text: 'на шістьох', servings: 6 });
    const items = nowItems(rows, [guests], d(2026, 3, 5));
    expect(items[0]).toMatchObject({ kind: 'tradition', title: 'Великий піст', strict: true, source: 'catalog', occasion_id: 'lent' });
    expect(items.find((i) => i.id === guests.id)).toMatchObject({ kind: 'custom', from: '2026-03-05', to: '2026-03-05', strict: false, source: 'chat', servings: 6 });
    expect(items[0]!.to).toBe('2026-04-11');
  });

  it('[ЗАРАЗ]: дієта мʼяко, піст суворо, план дому з id', () => {
    const rows = subscribedRows(BUILTIN_OCCASIONS, occasionSet(BUILTIN_OCCASIONS, 'orthodox').map((r) => ({ occasion_id: r.id, enabled: true })));
    const s = serializeNow(rows, [event({ from: '2026-03-01', to: '2026-03-30', rule: { t: 'once', at: '2026-03-01', days: 30 } })], d(2026, 3, 5));
    expect(s).toContain('[ЗАРАЗ]');
    expect(s).toContain('Великий піст · до 11 квіт.');
    expect(s).toContain('· суворо');
    expect(s).toContain('[aaaaaaaa] білкова · до 30 бер. · більше білка, менше вуглеводів · мʼяко');
    expect(s).not.toContain('[СЕЗОН І СВЯТА]');
    expect(s).not.toContain('[ТВОЇ ПЛАНИ]');
    expect(s.indexOf('· суворо')).toBeLessThan(s.indexOf('[aaaaaaaa]'));
  });

  it('план попереду (у горизонті) теж у блоці, закритий і згаслий — ні', () => {
    const rows = subscribedRows(BUILTIN_OCCASIONS, []);
    const soon = event({ kind: 'custom', title: 'гості', rule: { t: 'once', at: '2026-09-12' }, from: '2026-09-12', to: '2026-09-12', rule_text: null });
    const s = serializeNow(rows, [soon], d(2026, 9, 6));
    expect(s).toContain('[aaaaaaaa] гості · сб 12 вер. · мʼяко');
    expect(serializeNow(rows, [event({ ...soon, done_at: '2026-09-01T00:00:00.000Z' })], d(2026, 9, 6))).not.toContain('гості');
    expect(serializeNow(rows, [event({ ...soon, expires_at: '2020-01-01T00:00:00.000Z' })], d(2026, 9, 6))).not.toContain('гості');
  });
});

describe('вето суворих періодів', () => {
  it('суворий запис дає категорії з правила; мʼякий — нічого', () => {
    const strict = event({ strict: true, rule_text: 'без мʼяса, молочного, яєць', force: 'restrict', restricts: 'без мʼяса, молочного, яєць' });
    const rows = periodVetoRows(subscribedRows(BUILTIN_OCCASIONS, []), [strict], d(2026, 9, 10));
    expect(rows.map((r) => r.ref).sort()).toEqual(['молочне', 'мʼясо', 'яйця'].sort());
    expect(rows.every((r) => r.field === 'no' && !r.allergy)).toBe(true);
    expect(matchVeto('Свинячий фарш', rows).length).toBeGreaterThan(0);
    expect(matchVeto('Нут сушений', rows)).toEqual([]);
    expect(periodVetoRows(subscribedRows(BUILTIN_OCCASIONS, []), [event({ strict: false })], d(2026, 9, 10))).toEqual([]);
  });

  it('термін по датах: учора закінчилось — не діє, ще триває — діє', () => {
    const strict = event({ strict: true, rule_text: 'без мʼяса', from: '2026-09-01', to: '2026-09-09', rule: { t: 'once', at: '2026-09-01', days: 9 } });
    expect(periodVetoRows([], [strict], d(2026, 9, 10))).toEqual([]);
    expect(periodVetoRows([], [strict], d(2026, 9, 9)).map((r) => r.ref)).toEqual(['мʼясо']);
  });

  it('піст з довідника — вето через категорії рядка, лише по підписці', () => {
    const orthodox = subscribedRows(BUILTIN_OCCASIONS, occasionSet(BUILTIN_OCCASIONS, 'orthodox').map((r) => ({ occasion_id: r.id, enabled: true })));
    const rows = periodVetoRows(orthodox, [], d(2026, 3, 5));
    expect(rows.map((r) => r.ref)).toEqual(['тваринне']);
    expect(matchVeto('Свинячий фарш', rows).length).toBeGreaterThan(0);
    expect(periodVetoRows(subscribedRows(BUILTIN_OCCASIONS, []), [], d(2026, 3, 5))).toEqual([]);
  });
});

describe('таблиця дат наперед', () => {
  const table = buildOccasionTable();
  it('Великдень 2026: 12 квіт. православний, 5 квіт. католицький; Песах 2026 з 1 квіт.', () => {
    expect(table.find((e) => e.occasion_id === 'easter' && e.tradition === 'orthodox' && e.year === 2026)?.from).toBe('2026-04-12');
    expect(table.find((e) => e.occasion_id === 'easter' && e.tradition === 'catholic' && e.year === 2026)?.from).toBe('2026-04-05');
    expect(table.find((e) => e.occasion_id === 'pesach' && e.year === 2026)).toMatchObject({ from: '2026-04-01', to: '2026-04-09' });
    expect(table.find((e) => e.occasion_id === 'rosh' && e.year === 2026)?.from).toBe('2026-09-11');
    expect(table.find((e) => e.occasion_id === 'ramadan' && e.year === 2026)).toMatchObject({ from: '2026-02-18', approx: true });
  });

  it('без дірок: кожен привід кожного року 2026–2030', () => {
    for (const r of BUILTIN_OCCASIONS) {
      if (!isWindowRow(r)) continue;
      const trads = r.rule.t === 'easter' && !r.tradition ? ['orthodox', 'catholic'] : [null];
      for (const t of trads) {
        for (const y of [2026, 2027, 2028, 2029, 2030]) {
          const hit = table.find((e) => e.occasion_id === r.id && e.year === y && (t === null ? true : e.tradition === t));
          expect(hit, `${r.id} ${t ?? ''} ${y}`).toBeDefined();
          expect(hit!.from <= hit!.to, `${r.id} ${y}: ${hit!.from} > ${hit!.to}`).toBe(true);
        }
      }
    }
  });
});

describe('дрібниці', () => {
  it('пошук за назвою: «кавуни» → melon', () => {
    expect(findOccasionByTitle(BUILTIN_OCCASIONS, 'кавуни')?.id).toBe('melon');
    expect(findOccasionByTitle(BUILTIN_OCCASIONS, 'не показуй мені дині')?.id).toBe('melon');
    expect(findOccasionByTitle(BUILTIN_OCCASIONS, 'melon')?.id).toBe('melon');
    expect(findOccasionByTitle(BUILTIN_OCCASIONS, 'кроки')).toBeNull();
  });

  it('вікно запису й правило з дат', () => {
    expect(eventWindow({ rule: { t: 'once', at: '2026-09-01', days: 30 }, from: null, to: null })).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(ruleFromDates('2026-09-06', '2026-10-05')).toEqual({ t: 'once', at: '2026-09-06', days: 30 });
    expect(ruleFromDates('2026-09-12', '2026-09-12')).toEqual({ t: 'once', at: '2026-09-12' });
    const advent = BUILTIN_OCCASIONS.find((r) => r.id === 'advent')!;
    expect(isWindowRow(advent) && nextWindow(advent, d(2026, 12, 25), ['catholic'])?.from).toBe('2027-12-01');
    expect(occasionWhat(BUILTIN_OCCASIONS.find((r) => r.id === 'lent')!)).toBe('піст');
  });
});
