import { describe, it, expect } from 'vitest';
import {
  spanDays, isLasting, splitAxes, weekSpans, coversDay, edgeCaption,
  bubblesToNow, moreLabel, assignTones,
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
    expect(edgeCaption(e, at(1))).toBe('▮ ЧЕРЕМША · СЕЗОН ПОЧАВСЯ');
    expect(edgeCaption(e, at(4))).toBe('▮ ЧЕРЕМША · ОСТАННІЙ ДЕНЬ');
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
  it('обмеження вище свого, своє вище сезону', () => {
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

describe('банк кольорів', () => {
  it('одночасні події не збігаються кольором', () => {
    const tones = assignTones([ev(0, 5, { title: 'a' }), ev(2, 7, { title: 'b' }), ev(3, 4, { title: 'c' })]);
    const vals = [...tones.values()];
    expect(new Set(vals).size).toBe(3);
  });

  it('події, що не перетинаються, можуть узяти той самий тон', () => {
    const tones = assignTones([ev(0, 1, { title: 'a' }), ev(5, 6, { title: 'b' })]);
    expect(tones.get('a')).toBe(tones.get('b'));
  });

  it('обмеження поза банком — тон 0, слива', () => {
    const tones = assignTones([ev(0, 40, { title: 'піст', force: 'restrict' }), ev(1, 2, { title: 'гості' })]);
    expect(tones.get('піст')).toBe(0);
    expect(tones.get('гості')).toBeGreaterThan(0);
  });

  it('порядок не залежить від того, як події прийшли з мережі', () => {
    const a = ev(0, 5, { title: 'a' }), b = ev(2, 7, { title: 'b' });
    expect([...assignTones([a, b])]).toEqual([...assignTones([b, a])]);
  });

  it('повторювана подія тримає один колір на всіх входженнях', () => {
    // «Щопʼятниці риба» не має міняти барву щотижня.
    const w1 = ev(0, 0, { title: 'риба' });
    const w2 = { ...ev(7, 7, { title: 'риба' }), id: 'риба' };
    const tones = assignTones([w1, w2]);
    expect(tones.get('риба')).toBeDefined();
    expect(tones.size).toBe(1);
  });
});
