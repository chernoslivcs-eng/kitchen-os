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
