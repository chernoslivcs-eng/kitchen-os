import { describe, it, expect } from 'vitest';
import {
  nowProgress, nowWhen, nowItemToEvent, todayGroups, todayPointEvents, todayPointMeta,
  seasonSummary, aheadHorizon, aheadRows, aheadRowDate, aheadMeta,
} from './agenda';
import type { EventOccurrence, NowItem } from '../../api';

// Сьогодні пт 18.09.2026 (наповнення спеки 18.09, К8) — крім блоків «Далі»/
// «Сьогодні» (К9, 19.09), де сьогодні — субота 19.09, як у calendar-minimal-0919.html.
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

describe('nowItemToEvent: NowItem → EventOccurrence (резервний шлях кліку)', () => {
  it('власна подія (source user) — id справжній, scope household, rule_text лишається rule_text', () => {
    const it_: NowItem = {
      kind: 'diet', title: 'Без цукру', from: '2026-09-06', to: '2026-09-26', strict: true,
      source: 'user', id: 'diet1', rule_text: 'без цукру й солодкого',
    };
    const e = nowItemToEvent(it_);
    expect(e.id).toBe('diet1');
    expect(e.scope).toBe('household');
    expect(e.force).toBe('restrict');
    expect(e.rule_text).toBe('без цукру й солодкого');
    expect(e.restricts).toBeUndefined();
    expect(e.from).toBe('2026-09-06');
    expect(e.to).toBe('2026-09-26');
  });

  it('каталожна подія (source catalog) — id з occasion_id, scope catalog, rule_text → restricts', () => {
    const it_: NowItem = {
      kind: 'season', title: 'Сливи', from: '2026-07-20', to: '2026-09-21', strict: false,
      source: 'catalog', occasion_id: 'plum', meaning: 'сливи в пріоритеті', approx: true,
    };
    const e = nowItemToEvent(it_);
    expect(e.id).toBe('plum');
    expect(e.scope).toBe('catalog');
    expect(e.force).toBe('hint');
    expect(e.restricts).toBeNull();
    expect(e.meaning).toBe('сливи в пріоритеті');
    expect(e.approx).toBe(true);
  });

  it('каталожна подія з rule_text (пост) — переходить у restricts, не в rule_text', () => {
    const it_: NowItem = {
      kind: 'tradition', title: 'Різдвяний піст', from: '2026-11-28', to: '2027-01-06', strict: true,
      source: 'catalog', occasion_id: 'nativity-fast', rule_text: 'без мʼяса, риби, молочного і яєць',
    };
    const e = nowItemToEvent(it_);
    expect(e.restricts).toBe('без мʼяса, риби, молочного і яєць');
    expect(e.rule_text).toBeUndefined();
  });

  it('гості (source user, servings) — servings переносяться', () => {
    const it_: NowItem = { kind: 'custom', title: 'Гості', from: '2026-09-18', to: '2026-09-18', strict: false, source: 'user', id: 'guests1', servings: 6 };
    expect(nowItemToEvent(it_).servings).toBe(6);
  });
});

describe('todayGroups: строгі / мʼякі періоди / сезони (К9)', () => {
  const strictDiet: NowItem = { kind: 'diet', title: 'Без молочного', from: '2026-09-15', to: '2026-10-05', strict: true, source: 'user' };
  const softDiet: NowItem = { kind: 'diet', title: 'Набір ваги', from: '2026-08-01', to: '2026-10-30', strict: false, source: 'user' };
  const season: NowItem = { kind: 'season', title: 'Сливи', from: '2026-07-20', to: '2026-09-21', strict: false, source: 'catalog' };
  const oneDay: NowItem = { kind: 'custom', title: 'Гості', from: '2026-09-18', to: '2026-09-18', strict: false, source: 'user' };

  it('ділить на строгі/мʼякі періоди (from ≠ to, не сезон) і сезони; одноденні — геть (вони з events)', () => {
    const g = todayGroups([strictDiet, softDiet, season, oneDay]);
    expect(g.strict.map((i) => i.title)).toEqual(['Без молочного']);
    expect(g.soft.map((i) => i.title)).toEqual(['Набір ваги']);
    expect(g.seasons.map((i) => i.title)).toEqual(['Сливи']);
  });

  it('порожньо — усі три групи порожні', () => {
    const g = todayGroups([]);
    expect(g.strict).toEqual([]); expect(g.soft).toEqual([]); expect(g.seasons).toEqual([]);
  });
});

describe('todayPointEvents / todayPointMeta', () => {
  it('лише одноденні, чий день — сьогодні', () => {
    const guests = ev(0, 0, { title: 'Гості', servings: 6 });
    const tomorrow = ev(1, 1, { title: 'Завтра' });
    const lastingToday = ev(0, 5, { title: 'Тривала' });
    expect(todayPointEvents([guests, tomorrow, lastingToday], today).map((e) => e.title)).toEqual(['Гості']);
  });

  it('мета: гості — «N осіб», constraint — «рамка дня», supply — «постачання», custom без servings — null', () => {
    expect(todayPointMeta({ kind: 'custom', servings: 6 })).toBe('6 осіб');
    expect(todayPointMeta({ kind: 'constraint', servings: null })).toBe('рамка дня');
    expect(todayPointMeta({ kind: 'supply', servings: null })).toBe('постачання');
    expect(todayPointMeta({ kind: 'custom', servings: null })).toBeNull();
  });
});

describe('seasonSummary', () => {
  const s = (title: string, to: string): NowItem => ({ kind: 'season', title, from: '2026-06-01', to, strict: false, source: 'catalog' });

  it('нема сезонів — null', () => {
    expect(seasonSummary([], '2026-09-19')).toBeNull();
  });
  it('один сезон — назва й дата, без «+N»', () => {
    expect(seasonSummary([s('Сливи', '2026-09-20')], '2026-09-19')).toBe('Сезон: Сливи (до 20.09)');
  });
  it('три сезони — усі поіменно, без «+N»', () => {
    const out = seasonSummary([s('Сливи', '2026-09-20'), s('Білі гриби', '2026-11-01'), s('Виноград', '2026-10-15')], '2026-09-19');
    expect(out).toBe('Сезон: Сливи (до 20.09), Білі гриби, Виноград');
  });
  it('більше трьох — перший з датою, далі два імені, решта «+N»', () => {
    const seasons = [
      s('Сливи', '2026-09-20'), s('Пік овочевого', '2026-09-20'), s('Кавуни', '2026-09-30'),
      s('Виноград', '2026-10-15'), s('Білі гриби', '2026-11-01'), s('Опеньки', '2026-11-01'), s('Журавлина', '2026-11-01'),
    ];
    expect(seasonSummary(seasons, '2026-09-19')).toBe('Сезон: Сливи (до 20.09), Пік овочевого, Кавуни +4');
  });
});

describe('aheadHorizon: кінець третього місяця після поточного', () => {
  it('вересень → 31 грудня', () => {
    const d = new Date(aheadHorizon(new Date(2026, 8, 19).getTime()));
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 11, 31]);
  });
});

// Сьогодні субота 19.09.2026 (К9, той самий день, що в мокеті).
const at9 = (off: number, h = 0) => new Date(2026, 8, 19 + off, h).getTime();
const today9 = new Date(2026, 8, 19).getTime();
const horizon9 = aheadHorizon(today9); // 31.12.2026
const ev9 = (from: number, to: number, over: Partial<EventOccurrence> = {}): EventOccurrence => ({
  id: over.title ?? `e${from}-${to}`, scope: 'household', kind: 'custom',
  title: over.title ?? 'подія', start: at9(from), end: at9(to, 23), force: 'hint', ...over,
});

describe('aheadRows (К9): сезони геть, сьогодні геть, кінець лише для власних тривалих', () => {
  it('сезон — жодного рядка, навіть якщо стартує чи закінчується в горизонті', () => {
    const season = ev9(5, 40, { kind: 'season', scope: 'catalog', title: 'Хурма' });
    expect(aheadRows([season], today9, horizon9)).toEqual([]);
  });

  it('стартує сьогодні — не в «Далі» (воно в «Сьогодні»)', () => {
    const today_ = ev9(0, 0, { title: 'Гості сьогодні' });
    expect(aheadRows([today_], today9, horizon9)).toEqual([]);
  });

  it('власна одноденна в майбутньому — рядок-старт', () => {
    const guests = ev9(4, 4, { title: 'Гості на вечерю', servings: 6 });
    const rows = aheadRows([guests], today9, horizon9);
    expect(rows).toEqual([{ event: expect.objectContaining({ title: 'Гості на вечерю' }), kind: 'start' }]);
  });

  it('каталожне свято (tradition, одноденне) — рядок-старт, без кінця', () => {
    const feast = ev9(25, 25, { kind: 'tradition', scope: 'catalog', title: 'Покрова' });
    expect(aheadRows([feast], today9, horizon9)).toEqual([{ event: expect.objectContaining({ title: 'Покрова' }), kind: 'start' }]);
  });

  it('власний тривалий період, УЖЕ діє (старт у минулому) — лише рядок-кінець', () => {
    const diet = ev9(-14, 16, { kind: 'diet', title: 'Без молочного' }); // старт до сьогодні, кінець у горизонті
    expect(aheadRows([diet], today9, horizon9)).toEqual([{ event: expect.objectContaining({ title: 'Без молочного' }), kind: 'end' }]);
  });

  it('власний тривалий період, СТАРТУЄ в горизонті — рядок-старт І рядок-кінець (обидва)', () => {
    const weight = ev9(11, 41, { kind: 'diet', title: 'Набір ваги' });
    const rows = aheadRows([weight], today9, horizon9);
    expect(rows.map((r) => r.kind)).toEqual(['start', 'end']);
    expect(rows.every((r) => r.event.title === 'Набір ваги')).toBe(true);
  });

  it('каталожний тривалий (піст) — лише рядок-старт, кінця нема НІКОЛИ', () => {
    const fast = ev9(70, 109, { kind: 'tradition', scope: 'catalog', force: 'restrict', title: 'Різдвяний піст', restricts: 'без мʼяса, риби, молочного і яєць' });
    const rows = aheadRows([fast], today9, horizon9);
    expect(rows).toEqual([{ event: expect.objectContaining({ title: 'Різдвяний піст' }), kind: 'start' }]);
  });

  it('сортування — за релевантною датою рядка (старт для start, кінець для end)', () => {
    const b = ev9(20, 20, { title: 'B' });
    const aEnd = ev9(-5, 2, { kind: 'diet', title: 'A-кінець' }); // діє, кінець за 2 дні
    const c = ev9(1, 1, { title: 'C' });
    const rows = aheadRows([b, aEnd, c], today9, horizon9);
    expect(rows.map((r) => r.event.title)).toEqual(['C', 'A-кінець', 'B']);
  });

  it('за межею горизонту — жодного рядка', () => {
    const far = ev9(120, 120, { title: 'Далеко' });
    expect(aheadRows([far], today9, horizon9)).toEqual([]);
  });
});

describe('aheadRowDate / aheadMeta', () => {
  it('start — дата старту; end — дата кінця, мета «кінець»', () => {
    const e = ev9(11, 41, { kind: 'diet', title: 'Набір ваги' });
    const startRow = { event: e, kind: 'start' as const };
    const endRow = { event: e, kind: 'end' as const };
    expect(aheadRowDate(startRow)).toBe(e.start);
    expect(aheadRowDate(endRow)).toBe(e.end);
    expect(aheadMeta(endRow)).toBe('кінець');
  });

  it('тривала-старт — «до <кінець> · N днів · <rule_text>»', () => {
    const e = ev9(11, 41, { kind: 'diet', title: 'Набір ваги', rule_text: 'калорійніше' });
    expect(aheadMeta({ event: e, kind: 'start' })).toBe('до 30.10 · 31 день · калорійніше');
  });

  it('каталожний пост-старт — «до <кінець> · N днів · <restricts>»', () => {
    const e = ev9(70, 109, { kind: 'tradition', scope: 'catalog', title: 'Різдвяний піст', restricts: 'без мʼяса, риби, молочного і яєць' });
    expect(aheadMeta({ event: e, kind: 'start' })).toBe('до 06.01 · 40 днів · без мʼяса, риби, молочного і яєць');
  });

  it('одноденна-старт — рід за kind/гості; каталожне свято без деталей — null', () => {
    expect(aheadMeta({ event: ev9(4, 4, { title: 'Гості', servings: 6 }), kind: 'start' })).toBe('6 осіб');
    expect(aheadMeta({ event: ev9(4, 4, { kind: 'constraint', title: 'Мало часу' }), kind: 'start' })).toBe('рамка дня');
    expect(aheadMeta({ event: ev9(25, 25, { kind: 'tradition', scope: 'catalog', title: 'Покрова' }), kind: 'start' })).toBeNull();
  });
});
