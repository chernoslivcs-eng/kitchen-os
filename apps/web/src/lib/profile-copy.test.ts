import { describe, it, expect } from 'vitest';
import { SECTION } from './profile-copy';

// Строк лінка запрошення (рішення 03.10: сім днів замість трьох діб).
// «лінк діє 168 год» читається як помилка, хоч і правда, тому більше за добу
// показуємо в днях; менше доби лишається в годинах.
describe('inviteLinkHours', () => {
  it('більше за добу — у днях, з округленням угору', () => {
    expect(SECTION.inviteLinkHours(168)).toBe('лінк діє 7 дн.');
    expect(SECTION.inviteLinkHours(24)).toBe('лінк діє 1 дн.');
    // Півтори доби — це ще «два дні», а не «один»: лінк живий завтра.
    expect(SECTION.inviteLinkHours(36)).toBe('лінк діє 2 дн.');
  });

  it('менше доби — у годинах: «0 дн.» не каже нічого', () => {
    expect(SECTION.inviteLinkHours(23)).toBe('лінк діє 23 год');
    expect(SECTION.inviteLinkHours(1)).toBe('лінк діє 1 год');
  });
});
