import { describe, it, expect } from 'vitest';
import {
  nowProgress, nowWhen, aheadRows, aheadDateLabel, aheadMeta, bandLabel,
} from './agenda';
import type { EventOccurrence, NowItem } from '../../api';

// Сьогодні пт 18.09.2026 (наповнення спеки 18.09, К8).
const at = (off: number, h = 0) => new Date(2026, 8, 18 + off, h).getTime();
const today = new Date(2026, 8, 18).getTime();

const ev = (from: number, to: number, over: Partial<EventOccurrence> = {}): EventOccurrence => ({
  id: over.title ?? `e${from}-${to}`, scope: 'household', kind: 'custom',
  title: over.title ?? 'подія', start: at(from), end: at(to, 23), force: 'hint', ...over,
});

describe('nowProgress: прогрес лише для власної дієти з датою початку', () => {
  it('своя дієта з from — 4-й день з 21', () => {
    const it_: Pick<NowItem, 'kind' | 'source' | 'from' | 'to'> = { kind: 'diet', source: 'user', from: '2026-09-15', to: '2026-10-05' };
    expect(nowProgress(it_, '2026-09-18')).toEqual({ dayN: 4, total: 21, pct: Math.round((4 / 21) * 100) });
  });
  it('сезон з каталогу — без прогресу (нема свого початку)', () => {
    const it_: Pick<NowItem, 'kind' | 'source' | 'from' | 'to'> = { kind: 'season', source: 'catalog', from: '2026-07-20', to: '2026-09-30' };
    expect(nowProgress(it_, '2026-09-18')).toBeNull();
  });
  it('своя подія не-дієта (гості, custom) — без прогресу', () => {
    const it_: Pick<NowItem, 'kind' | 'source' | 'from' | 'to'> = { kind: 'custom', source: 'user', from: '2026-09-15', to: '2026-09-20' };
    expect(nowProgress(it_, '2026-09-18')).toBeNull();
  });
  it('одноденна дієта (from === to) — без прогресу (ділити нема на що)', () => {
    const it_: Pick<NowItem, 'kind' | 'source' | 'from' | 'to'> = { kind: 'diet', source: 'user', from: '2026-09-18', to: '2026-09-18' };
    expect(nowProgress(it_, '2026-09-18')).toBeNull();
  });
});

describe('nowWhen', () => {
  it('з прогресом — «N-й день з M»', () => {
    const it_: NowItem = { kind: 'diet', source: 'user', from: '2026-09-15', to: '2026-10-05', title: 'Без молочного', strict: true, rule_text: 'без молока, сирів, вершків' };
    expect(nowWhen(it_, '2026-09-18')).toBe('4-й день з 21');
  });
  it('без прогресу — «до дати»', () => {
    const it_: NowItem = { kind: 'season', source: 'catalog', from: '2026-07-20', to: '2026-09-21', title: 'Сливи', strict: false, meaning: 'сливи в пріоритеті' };
    expect(nowWhen(it_, '2026-09-18')).toBe('до 21.09');
  });
  it('≈ — коли дати приблизні', () => {
    const it_: NowItem = { kind: 'season', source: 'catalog', from: '2026-07-20', to: '2026-09-21', title: 'Сливи', strict: false, approx: true };
    expect(nowWhen(it_, '2026-09-18')).toBe('до ≈ 21.09');
  });
});

describe('aheadRows: лише майбутнє', () => {
  // Уточнення К3 (ГОЛОВНИЙ ЧАТ, живі дані 18.09): «готування сьогодні —
  // геть» — це сесія готування в процесі (cook-session, не /v1/events), НЕ
  // заплановані вечері/гості дому (kind 'meal', власна подія з датою). Такі
  // йдуть звичайним рядком «Попереду» — «19.09 сб · Гості на вечерю · 6 осіб».
  it('kind meal у майбутньому (гості на вечерю) — попереду, як звичайна одноденна', () => {
    const rows = aheadRows([ev(1, 1, { kind: 'meal', title: 'Гості на вечерю', servings: 6 })], today, at(60));
    expect(rows).toEqual([{ event: expect.objectContaining({ title: 'Гості на вечерю' }), endingSoon: false }]);
  });
  it('kind meal сьогодні — не попереду (те саме правило, що для будь-якого кінду)', () => {
    const rows = aheadRows([ev(0, 0, { kind: 'meal', title: 'Панкейки' })], today, at(60));
    expect(rows).toEqual([]);
  });
  it('минуле (кінець раніше за сьогодні) — геть', () => {
    const rows = aheadRows([ev(-10, -2, { title: 'минуле' })], today, at(60));
    expect(rows).toEqual([]);
  });
  it('за межею горизонту — геть', () => {
    const rows = aheadRows([ev(90, 90, { title: 'далеко' })], today, at(60));
    expect(rows).toEqual([]);
  });
  it('одноденна в майбутньому — попереду', () => {
    const rows = aheadRows([ev(1, 1, { title: 'Гості' })], today, at(60));
    expect(rows).toEqual([{ event: expect.objectContaining({ title: 'Гості' }), endingSoon: false }]);
  });
  it('тривала, що ще не почалась — попереду, endingSoon false', () => {
    const rows = aheadRows([ev(12, 42, { title: 'Набір ваги' })], today, at(60));
    expect(rows).toEqual([{ event: expect.objectContaining({ title: 'Набір ваги' }), endingSoon: false }]);
  });
  it('тривала, що вже триває і скінчиться в горизонті — endingSoon true', () => {
    const rows = aheadRows([ev(-20, 3, { title: 'Сливи' })], today, at(60));
    expect(rows).toEqual([{ event: expect.objectContaining({ title: 'Сливи' }), endingSoon: true }]);
  });
  it('тривала, що вже триває і закінчується СЬОГОДНІ — не попереду (це «зараз»)', () => {
    const rows = aheadRows([ev(-20, 0, { title: 'кінчається сьогодні' })], today, at(60));
    expect(rows).toEqual([]);
  });
  it('одноденна подія сьогодні — не попереду', () => {
    const rows = aheadRows([ev(0, 0, { title: 'сьогодні' })], today, at(60));
    expect(rows).toEqual([]);
  });
  it('сортування — за релевантною датою (старт для майбутніх, кінець для тих, що добігають)', () => {
    const rows = aheadRows([
      ev(20, 20, { title: 'B' }),
      ev(-5, 2, { title: 'A-ending' }),
      ev(1, 1, { title: 'C' }),
    ], today, at(60));
    expect(rows.map((r) => r.event.title)).toEqual(['C', 'A-ending', 'B']);
  });
});

describe('aheadDateLabel / aheadMeta', () => {
  it('тривала майбутня — «старт → кінець · N днів»', () => {
    const row = { event: ev(12, 42, { title: 'Набір ваги' }), endingSoon: false };
    expect(aheadDateLabel(row)).toBe('30.09 – 30.10 · 31 день');
  });
  it('одноденна майбутня — «дата день-тижня»', () => {
    const row = { event: ev(1, 1, { title: 'Гості' }), endingSoon: false };
    expect(aheadDateLabel(row)).toBe('19.09 сб');
  });
  it('endingSoon — дата кінця, «останні дні»', () => {
    const row = { event: ev(-20, 3, { title: 'Сливи' }), endingSoon: true };
    expect(aheadDateLabel(row)).toBe('21.09 пн');
    expect(aheadMeta(row)).toBe('останні дні');
  });
  it('мета — restricts, інакше кількість гостей, інакше нічого', () => {
    const withRestricts = { event: ev(70, 109, { title: 'Різдвяний піст', restricts: 'без мʼяса, риби, молочного і яєць' }), endingSoon: false };
    expect(aheadMeta(withRestricts)).toBe('без мʼяса, риби, молочного і яєць');
    const withGuests = { event: ev(1, 1, { title: 'Гості', servings: 6 }), endingSoon: false };
    expect(aheadMeta(withGuests)).toBe('6 осіб');
    const plain = { event: ev(11, 11, { title: 'Покрова' }), endingSoon: false };
    expect(aheadMeta(plain)).toBeNull();
  });
});

// К7-бис (ГОЛОВНИЙ ЧАТ, живі дані 18.09): смуга в сітці мала колір і без
// підпису — незрозуміло, яка лінія що. Мокет (weeks2/bandDefs) рахує label
// окремо на кожному тижні: повна назва + дата на ≥3-денному сегменті,
// сама назва — на 1–2 днях.
describe('bandLabel: підпис смуги в сітці, за тижнем окремо', () => {
  const todayIso = new Date(2026, 8, 18).getTime();

  it('сегмент 1–2 дні (тісно) — лише назва, без дати', () => {
    expect(bandLabel({ title: 'Без молочного', start: at(-3), end: at(17) }, 1, todayIso)).toBe('Без молочного');
    expect(bandLabel({ title: 'Без молочного', start: at(-3), end: at(17) }, 2, todayIso)).toBe('Без молочного');
  });

  it('сегмент ≥3 дні, подія вже почалась — «назва · до <кінець>»', () => {
    expect(bandLabel({ title: 'Без молочного', start: at(-3), end: at(17) }, 3, todayIso)).toBe('Без молочного · до 05.10');
    expect(bandLabel({ title: 'Без молочного', start: at(-3), end: at(17) }, 7, todayIso)).toBe('Без молочного · до 05.10');
  });

  it('сегмент ≥3 дні, подія ще не почалась — «назва · старт – кінець»', () => {
    expect(bandLabel({ title: 'Набір ваги', start: at(12), end: at(42) }, 5, todayIso)).toBe('Набір ваги · 30.09 – 30.10');
  });

  it('≈ — коли дати приблизні (наближений піст)', () => {
    expect(bandLabel({ title: 'Різдвяний піст', start: at(-3), end: at(17), approx: true }, 4, todayIso)).toBe('Різдвяний піст · до ≈ 05.10');
    expect(bandLabel({ title: 'Різдвяний піст', start: at(12), end: at(42), approx: true }, 4, todayIso)).toBe('Різдвяний піст · 30.09 – ≈ 30.10');
  });

  it('той самий підпис на кожному тижні — не лише на першому (мокет рахує label per-week)', () => {
    const e = { title: 'Без молочного', start: at(-3), end: at(17) };
    // Тиждень посередині діапазону — теж повний підпис, якщо сегмент ≥3 дні.
    expect(bandLabel(e, 5, todayIso)).toBe('Без молочного · до 05.10');
  });
});
