import { describe, it, expect } from 'vitest';
import {
  spanDays, isLasting, splitAxes, weekSpans, coversDay, edgeCaption,
  bubblesToNow, moreLabel, rank, railable, assignLanes, weekBands, GRID_LANES,
} from './spans';
import type { EventOccurrence } from '../api';

// Понеділок 2026-03-02.
const mon = new Date(2026, 2, 2).getTime();
const at = (off: number, h = 0) => new Date(2026, 2, 2 + off, h).getTime();
const DAY_MS = 86_400_000;

const ev = (from: number, to: number, over: Partial<EventOccurrence> = {}): EventOccurrence => ({
  id: over.title ?? `e${from}-${to}`, scope: 'household', kind: 'custom',
  title: over.title ?? 'подія', start: at(from), end: at(to, 23), force: 'hint', ...over,
});

describe('дві осі', () => {
  it('подія на один день — точкова, на два і більше — тривала', () => {
    expect(spanDays(ev(0, 0))).toBe(1);
    expect(isLasting(ev(0, 0))).toBe(false);
    expect(spanDays(ev(0, 1))).toBe(2);
    expect(isLasting(ev(0, 1))).toBe(true);
  });

  it('ніщо не потрапляє в обидві осі', () => {
    const { lasting, point } = splitAxes([ev(0, 0, { title: 'гості' }), ev(0, 5, { title: 'піст' })]);
    expect(point.map((e) => e.title)).toEqual(['гості']);
    expect(lasting.map((e) => e.title)).toEqual(['піст']);
  });

  it('довші стоять у рейці вище', () => {
    const { lasting } = splitAxes([ev(1, 3, { title: 'коротка' }), ev(0, 6, { title: 'довга' })]);
    expect(lasting.map((e) => e.title)).toEqual(['довга', 'коротка']);
  });
});

describe('смуги тижня', () => {
  it('подія всередині тижня дає свої колонки', () => {
    // ЧТ–НД: колонки 4..7 → grid-column 4 / 8
    const [s] = weekSpans([ev(3, 6)], mon);
    expect(s).toMatchObject({ from: 4, to: 8, openLeft: false, openRight: false });
  });

  it('подія, що почалась раніше, має відкритий лівий край', () => {
    const [s] = weekSpans([ev(-10, 2)], mon);
    expect(s).toMatchObject({ from: 1, to: 4, openLeft: true, openRight: false });
  });

  it('подія, що триває далі, має відкритий правий', () => {
    const [s] = weekSpans([ev(1, 40)], mon);
    expect(s).toMatchObject({ from: 2, to: 8, openLeft: false, openRight: true });
  });

  it('подія повз тиждень у смуги не потрапляє', () => {
    expect(weekSpans([ev(20, 25)], mon)).toEqual([]);
    expect(weekSpans([ev(-30, -20)], mon)).toEqual([]);
  });
});

describe('риска й підписи', () => {
  it('риска йде всі дні події', () => {
    const e = ev(1, 4);
    expect(coversDay(e, at(0))).toBe(false);
    expect(coversDay(e, at(2))).toBe(true);
    expect(coversDay(e, at(4))).toBe(true);
    expect(coversDay(e, at(5))).toBe(false);
  });

  it('підпис лише на краях, у середині мовчить', () => {
    const e = ev(1, 4, { title: 'черемша', kind: 'season' });
    // Формат макета: старт несе «ДО дд.мм», кінець — «КІНЕЦЬ».
    expect(edgeCaption(e, at(1))).toMatch(/^черемша · сезон · до \d{2}\.\d{2}$/);
    expect(edgeCaption(e, at(4))).toBe('черемша · кінець');
    expect(edgeCaption(e, at(2))).toBeNull();
  });
});

describe('що підіймається в ЗАРАЗ', () => {
  it('перший день і останні три — так, середина — ні', () => {
    // Піст на 48 днів: не мовчить лише на вході й на виході.
    const lent = ev(0, 47);
    expect(bubblesToNow(lent, at(0))).toBe(true);
    expect(bubblesToNow(lent, at(20))).toBe(false);
    expect(bubblesToNow(lent, at(45))).toBe(true);
    expect(bubblesToNow(lent, at(47))).toBe(true);
    expect(bubblesToNow(lent, at(48))).toBe(false);
  });

  it('точкова підіймається завжди', () => {
    expect(bubblesToNow(ev(3, 3), at(0))).toBe(true);
  });
});

describe('ліміт три', () => {
  it('«ЩЕ N» називає першу приховану', () => {
    expect(moreLabel([ev(0, 0, { title: 'Галина іменини' })])).toBe('ще 1 · Галина іменини');
    expect(moreLabel([ev(0, 0, { title: 'а' }), ev(1, 1, { title: 'б' })], false)).toBe('ще 2');
    expect(moreLabel([])).toBeNull();
  });
});

describe('порядок у рейці', () => {
  it('порядок роду: обмеження → своє → сезон → свято → редакційна', () => {
    // Живий прогін показав протилежне: сезонів буває чотири, вони найдовші,
    // ліміт три — і власний план людини щоразу тонув у «ЩЕ N».
    const season = ev(0, 60, { title: 'сезон', scope: 'catalog', kind: 'season' });
    const mine = ev(1, 5, { title: 'цибуля', scope: 'household', kind: 'supply' });
    const lent = ev(0, 48, { title: 'піст', scope: 'catalog', force: 'restrict' });
    const { lasting } = splitAxes([season, mine, lent]);
    expect(lasting.map((e) => e.title)).toEqual(['піст', 'цибуля', 'сезон']);
  });

  it('усередині рангу довші лишаються вище', () => {
    const a = ev(0, 10, { title: 'довга', scope: 'household' });
    const b = ev(0, 3, { title: 'коротка', scope: 'household' });
    const { lasting } = splitAxes([b, a]);
    expect(lasting.map((e) => e.title)).toEqual(['довга', 'коротка']);
  });
});



describe('хто отримує риску', () => {
  it('редакційна не отримує ніколи, навіть коли місце є', () => {
    // Вона живе в рядку «тривають зараз» і має імʼя тільки там.
    expect(railable(ev(0, 5, { kind: 'editorial', scope: 'catalog' }))).toBe(false);
    expect(railable(ev(0, 5, { scope: 'catalog', source: 'Kitchen OS' }))).toBe(false);
    expect(railable(ev(0, 5, { kind: 'season', scope: 'catalog' }))).toBe(true);
  });

  it('ховається першою теж редакційна, обмеження — ніколи', () => {
    const order = [
      ev(0, 5, { title: 'редакційна', kind: 'editorial', scope: 'catalog' }),
      ev(0, 5, { title: 'свято', kind: 'tradition', scope: 'catalog' }),
      ev(0, 5, { title: 'сезон', kind: 'season', scope: 'catalog' }),
      // Страва з плану — теж своя, але тихіша за подію: рішення вже ухвалене.
      ev(0, 5, { title: 'страва', kind: 'meal', scope: 'household' }),
      ev(0, 5, { title: 'своя', scope: 'household' }),
      ev(0, 5, { title: 'піст', scope: 'catalog', force: 'restrict' }),
    ].sort((a, b) => rank(a) - rank(b)).map((e) => e.title);
    expect(order).toEqual(['піст', 'своя', 'страва', 'сезон', 'свято', 'редакційна']);
  });
});

describe('доріжки рисок', () => {
  it('подія тримає свою смугу на всю довжину', () => {
    // Без цього лінії зигзагують: нова подія зсуває решту праворуч.
    const season = ev(0, 30, { title: 'сезон', kind: 'season', scope: 'catalog' });
    const own = ev(3, 8, { title: 'своя', scope: 'household' });
    const lanes = assignLanes([season, own]);
    // Своя вище за родом — бере нульову; сезон лишається на своїй усі 30 днів.
    expect(lanes.get('своя')).toBe(0);
    expect(lanes.get('сезон')).toBe(1);
  });

  it('події, що не перетинаються, ділять одну доріжку', () => {
    const a = ev(0, 3, { title: 'a', scope: 'household' });
    const b = ev(5, 8, { title: 'b', scope: 'household' });
    expect(assignLanes([a, b]).get('a')).toBe(assignLanes([a, b]).get('b'));
  });

  it('редакційна доріжки не отримує зовсім', () => {
    const ed = ev(0, 5, { title: 'томати', kind: 'editorial', scope: 'catalog' });
    expect(assignLanes([ed]).has('томати')).toBe(false);
  });

  it('обмеження бере першу доріжку й не ховається', () => {
    const lanes = assignLanes([
      ev(0, 40, { title: 'сезон', kind: 'season', scope: 'catalog' }),
      ev(0, 40, { title: 'своя', scope: 'household' }),
      ev(0, 40, { title: 'піст', scope: 'catalog', force: 'restrict' }),
      ev(0, 40, { title: 'свято', kind: 'tradition', scope: 'catalog' }),
    ]);
    expect(lanes.get('піст')).toBe(0);
    expect(lanes.get('свято')).toBe(3);   // за межею трьох — риски не буде
  });
});

// 12.09 (ANSWERS B4/B5): стеля ≤ 3 для смуг сезонів у тижні й чіпів у шапці —
// за рангом «починається цього тижня → закінчується найближче» (усередині
// сезонів; обмеження і своє стоять вище, як у rank()). Хвіст — «ще N».
import { capLasting, tailLabel } from './spans';

describe('стеля три для сезонів (B4/B5)', () => {
  const season = (from: number, to: number, title: string) =>
    ev(from, to, { title, scope: 'catalog', kind: 'season' });

  it('до трьох — усе видно, хвоста нема', () => {
    const { shown, hidden } = capLasting([season(0, 20, 'а'), season(1, 30, 'б')], mon);
    expect(shown.length).toBe(2);
    expect(hidden).toEqual([]);
    expect(tailLabel(hidden)).toBeNull();
  });

  it('понад три: спершу ті, що починаються цього тижня, далі — що закінчуються найближче', () => {
    const list = [
      season(-20, 40, 'довгий'),      // почався давно, кінець далеко
      season(-10, 3, 'кінчається'),   // почався давно, кінець цього тижня
      season(2, 60, 'новий'),         // починається цього тижня
      season(-30, 15, 'середній'),
      season(4, 50, 'новий-2'),
    ];
    const { shown, hidden } = capLasting(list, mon);
    expect(shown.map((e) => e.title)).toEqual(['новий-2', 'новий', 'кінчається']); // серед нових — той, що скінчиться раніше
    expect(hidden.map((e) => e.title)).toEqual(['середній', 'довгий']);
    expect(tailLabel(hidden)).toBe('ще 2 сезони');
  });

  it('обмеження і своя подія не ховаються за сезонами', () => {
    const list = [season(0, 9, 'с1'), season(0, 9, 'с2'), season(0, 9, 'с3'),
      ev(3, 5, { title: 'мама' }), ev(-5, 40, { title: 'піст', scope: 'catalog', kind: 'tradition', force: 'restrict' })];
    const { shown, hidden } = capLasting(list, mon);
    expect(shown.map((e) => e.title)).toEqual(['піст', 'мама', 'с1']);
    expect(tailLabel(hidden)).toBe('ще 2 сезони');
  });

  it('хвіст без сезонів — просто «ще N»', () => {
    expect(tailLabel([ev(0, 4, { title: 'гості' })])).toBe('ще 1');
    expect(tailLabel([ev(0, 4, { title: 'а' }), season(0, 4, 'б')])).toBe('ще 2');
  });
});

// Календар v3 (spec 18.09, «Р2. Доріжки в сітці»): подія тримає СВОЮ
// доріжку на кожному тижні, який перетинає; максимум GRID_LANES (3), далі —
// overflow по днях («+N», розкриття по тапу).
describe('смуги сітки: 4 паралельні події, дві перетинають кілька тижнів', () => {
  // week1 = [0..6] (mon), week2 = [7..13], week3 = [14..20].
  const week1 = mon;
  const week2 = mon + 7 * DAY_MS;
  const pist = ev(0, 20, { title: 'піст', scope: 'catalog', force: 'restrict' });       // 21 днів, week1→3
  const svojaA = ev(0, 10, { title: 'своя-а', scope: 'household' });                    // week1→2
  const svojaB = ev(3, 17, { title: 'своя-б', scope: 'household' });                    // week1→3
  const svojaV = ev(5, 9, { title: 'своя-в', scope: 'household' });                     // week1→2, 4-та — overflow
  const four = [pist, svojaA, svojaB, svojaV];

  it('lane assignment: обмеження перше, далі власні за стартом; четверта — за межею GRID_LANES', () => {
    const lanes = assignLanes(four);
    expect(lanes.get('піст')).toBe(0);
    expect(lanes.get('своя-а')).toBe(1);
    expect(lanes.get('своя-б')).toBe(2);
    expect(lanes.get('своя-в')).toBe(3);
    expect(lanes.get('своя-в')).toBeGreaterThanOrEqual(GRID_LANES);
  });

  it('перші три доріжки — смуги в обох тижнях, той самий ряд (доріжка тримається)', () => {
    const lanes = assignLanes(four);
    const w1 = weekBands(four, lanes, week1);
    const w2 = weekBands(four, lanes, week2);
    const laneIn = (bands: typeof w1.bands, title: string) => bands.find((b) => b.event.title === title)?.lane;
    expect(laneIn(w1.bands, 'піст')).toBe(0);
    expect(laneIn(w2.bands, 'піст')).toBe(0);
    expect(laneIn(w1.bands, 'своя-б')).toBe(2);
    expect(laneIn(w2.bands, 'своя-б')).toBe(2);
    // Рівно три смуги в кожному тижні — не більше GRID_LANES.
    expect(w1.bands.length).toBeLessThanOrEqual(GRID_LANES);
    expect(w2.bands.length).toBeLessThanOrEqual(GRID_LANES);
  });

  it('четверта подія (за межею трьох) не дає смуги — лише overflow по днях, які перетинає', () => {
    const lanes = assignLanes(four);
    const { bands, overflow } = weekBands(four, lanes, week1);
    expect(bands.some((b) => b.event.title === 'своя-в')).toBe(false);
    // «своя-в» триває 5..9 — у week1 це дні 5 і 6.
    expect(overflow.get(mon + 5 * DAY_MS)).toBe(1);
    expect(overflow.get(mon + 6 * DAY_MS)).toBe(1);
    expect(overflow.has(mon + 2 * DAY_MS)).toBe(false);
  });

  it('overflow рахує дні, не події: два «зайвих» в один день дають один «+2», не два «+1»', () => {
    const another = ev(5, 9, { title: 'ще-одна', scope: 'household' });
    const five = [...four, another];
    const lanes = assignLanes(five);
    const { overflow } = weekBands(five, lanes, week1);
    expect(overflow.get(mon + 5 * DAY_MS)).toBe(2);
  });
});
