// Серія «наповнюю комору» (19.09): чиста арифметика стану.
import { describe, it, expect } from 'vitest';
import { streakActive, onIntakeApply, startStreak, breakStreak, isAllToPantry } from '../intake-streak.js';

const T0 = new Date('2026-09-19T10:00:00.000Z');
const plus = (min: number) => new Date(T0.getTime() + min * 60_000);

describe('intake streak', () => {
  it('один apply — ще не серія; другий за ≤ 15 хв — серія на 20 хв; кожен apply продовжує', () => {
    const s1 = onIntakeApply({}, T0);
    expect(streakActive(s1, plus(1))).toBe(false);
    const s2 = onIntakeApply(s1, plus(10));
    expect(streakActive(s2, plus(11))).toBe(true);
    expect(s2.intake_streak_until).toBe(plus(30).toISOString());
    const s3 = onIntakeApply(s2, plus(25));
    expect(s3.intake_streak_until).toBe(plus(45).toISOString());
  });
  it('другий apply через > 15 хв — не серія', () => {
    const s = onIntakeApply(onIntakeApply({}, T0), plus(16));
    expect(streakActive(s, plus(17))).toBe(false);
  });
  it('серія спливає за until; startStreak/breakStreak', () => {
    const s = startStreak(T0);
    expect(streakActive(s, plus(19))).toBe(true);
    expect(streakActive(s, plus(21))).toBe(false);
    expect(streakActive(breakStreak(), plus(1))).toBe(false);
  });
  it('isAllToPantry: «все у комору» / «всё в комору» / «все в комору» / «усе в комору», нормалізовано; не «все» окремо', () => {
    for (const t of ['все у комору', 'Всё в комору!', 'ок, все в комору', 'Усе в комору.', 'ВСЕ У КОМОРУ']) expect(isAllToPantry(t)).toBe(true);
    for (const t of ['все', 'у комору', 'все у коморі є', 'додай все']) expect(isAllToPantry(t)).toBe(false);
  });
});
