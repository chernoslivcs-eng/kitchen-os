import { describe, it, expect } from 'vitest';
import {
  spanDays, isLasting, splitAxes, weekSpans, coversDay, edgeCaption,
  bubblesToNow, moreLabel, rank, railable, assignLanes,
} from './spans';
import type { EventOccurrence } from '../api';

const DAY = 86_400_000;
// Понеділок 2026-03-02.
const mon = new Date(2026, 2, 2).getTime();
const at = (off: number, h = 0) => new Date(2026, 2, 2 + off, h).getTime();

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
    expect(edgeCaption(e, at(1))).toMatch(/^▮ ЧЕРЕМША · СЕЗОН ПОЧАВСЯ · ДО \d{2}\.\d{2}$/);
    expect(edgeCaption(e, at(4))).toBe('▮ ЧЕРЕМША · КІНЕЦЬ');
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
    expect(moreLabel([ev(0, 0, { title: 'Галина іменини' })])).toBe('ЩЕ 1 · ГАЛИНА ІМЕНИНИ');
    expect(moreLabel([ev(0, 0, { title: 'а' }), ev(1, 1, { title: 'б' })], false)).toBe('ЩЕ 2');
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
