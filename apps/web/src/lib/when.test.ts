import { describe, it, expect } from 'vitest';
import { whenLabel, isLive } from './when';

const DAY = 86_400_000;
const now = new Date('2026-09-10T12:00:00').getTime();

describe('whenLabel', () => {
  it('те, що триває, називається кінцем, а не серединою', () => {
    // Сезон грибів другий тиждень: важливо не «триває», а скільки лишилось.
    expect(whenLabel(now - 9 * DAY, now + 28 * DAY, now)).toContain('ще 4 тижні');
    expect(whenLabel(now - 2 * DAY, now + 3 * DAY, now)).toBe('ще 3 дні');
    expect(whenLabel(now - 2 * DAY, now + DAY, now)).toBe('до завтра');
    expect(whenLabel(now - 2 * DAY, now, now)).toBe('останній день');
  });

  it('майбутнє — за скільки', () => {
    expect(whenLabel(now + DAY, now + DAY, now)).toBe('завтра');
    expect(whenLabel(now + 3 * DAY, now + 3 * DAY, now)).toBe('за 3 дні');
    expect(whenLabel(now + 10 * DAY, now + 10 * DAY, now)).toBe('за тиждень');
    expect(whenLabel(now + 21 * DAY, now + 21 * DAY, now)).toBe('за 3 тижні');
  });

  it('далеке — датою, бо «за 9 тижнів» уже нічого не означає', () => {
    expect(whenLabel(now + 70 * DAY, now + 70 * DAY, now)).toMatch(/\d/);
  });

  it('відмінки рахуються, а не приклеюються', () => {
    expect(whenLabel(now + 2 * DAY, now + 2 * DAY, now)).toBe('за 2 дні');
    expect(whenLabel(now + 5 * DAY, now + 5 * DAY, now)).toBe('за 5 днів');
  });

  it('isLive: усередині вікна — так, поза ним — ні', () => {
    expect(isLive(now - DAY, now + DAY, now)).toBe(true);
    expect(isLive(now + DAY, now + 2 * DAY, now)).toBe(false);
  });
});

describe('день, а не доба', () => {
  // Перша версія ділила мілісекунди: подія завтра о 00:00 при поточних 12:00
  // давала 0.48 доби → «сьогодні». Живий прогін показав це на тижневому
  // правилі — найближча пʼятниця завтра, а сторінка казала «сьогодні».
  const noon = new Date(2026, 8, 3, 12, 0).getTime();
  const midnight = (dayOffset: number) => new Date(2026, 8, 3 + dayOffset, 0, 0).getTime();
  const endOf = (dayOffset: number) => new Date(2026, 8, 3 + dayOffset, 23, 59).getTime();

  it('завтра з півночі — це завтра, а не сьогодні', () => {
    expect(whenLabel(midnight(1), endOf(1), noon)).toBe('завтра');
  });

  it('сьогоднішня подія — сьогодні', () => {
    expect(whenLabel(midnight(0), endOf(0), noon)).toBe('останній день');
  });

  it('післязавтра — за 2 дні, а не за 1', () => {
    expect(whenLabel(midnight(2), endOf(2), noon)).toBe('за 2 дні');
  });
});
