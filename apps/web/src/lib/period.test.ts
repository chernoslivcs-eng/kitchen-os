import { describe, it, expect } from 'vitest';
import { leftLabel, dedupeTitle, seriesRange, shortDate, toneOfNow, ownKindOf } from './period';

// П2: межі «ще N днів», дубль заголовка в правилі, тон за джерелом.
describe('leftLabel', () => {
  const today = '2026-09-06';
  it('триває — «ще N днів»; останній день; до завтра', () => {
    expect(leftLabel('2026-09-01', '2026-09-30', today)).toBe('ще 24 дні');
    expect(leftLabel('2026-09-01', '2026-09-06', today)).toBe('останній день');
    expect(leftLabel('2026-09-01', '2026-09-07', today)).toBe('до завтра');
  });
  it('минуле — не показувати', () => {
    expect(leftLabel('2026-08-01', '2026-09-05', today)).toBeNull();
  });
  it('попереду — «за N днів» / «завтра»', () => {
    expect(leftLabel('2026-09-12', '2026-09-12', today)).toBe('за 6 днів');
    expect(leftLabel('2026-09-07', '2026-09-08', today)).toBe('завтра');
  });
});

describe('dedupeTitle', () => {
  it('правило починається з заголовка — лише правило', () => {
    expect(dedupeTitle('білкова', 'білкова — більше білка, менше вуглеводів')).toEqual({ title: null, rule: 'білкова — більше білка, менше вуглеводів' });
    expect(dedupeTitle('Білкова', 'білкова')).toEqual({ title: null, rule: 'білкова' });
  });
  it('правила нема — лише заголовок; різні — обидва', () => {
    expect(dedupeTitle('гості', null)).toEqual({ title: 'гості', rule: null });
    expect(dedupeTitle('гості', 'на шістьох')).toEqual({ title: 'гості', rule: 'на шістьох' });
  });
});

describe('дрібниці', () => {
  it('shortDate без крапки; діапазон серії по місяцях', () => {
    expect(shortDate('2026-04-01')).toBe('1 квіт');
    expect(seriesRange([{ from: '2026-09-11', to: '2026-09-13' }, { from: '2027-04-21', to: '2027-04-29' }])).toBe('вересень 2026 – квітень 2027');
    expect(seriesRange([{ from: '2026-12-01', to: '2026-12-23' }, { from: '2026-12-24', to: '2026-12-26' }])).toBe('грудень 2026');
  });
  it('тон: суворе — слива; свято — слива; сезон — бурштин; своє — шавлія', () => {
    expect(toneOfNow({ kind: 'diet', strict: true, source: 'chat' })).toBe('restrict');
    expect(toneOfNow({ kind: 'tradition', strict: false, source: 'catalog' })).toBe('tradition');
    expect(toneOfNow({ kind: 'season', strict: false, source: 'catalog' })).toBe('season');
    expect(toneOfNow({ kind: 'diet', strict: false, source: 'chat' })).toBe('own');
  });
  it('рід свого: дієта; custom без порцій — своє свято; з порціями — подія дому', () => {
    expect(ownKindOf('diet')).toBe('diet');
    expect(ownKindOf('custom', null)).toBe('holiday');
    expect(ownKindOf('custom', 6)).toBe('custom');
  });
});
