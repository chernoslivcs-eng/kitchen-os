import { describe, it, expect } from 'vitest';
import { EQUIP_EXTRA, DIET_PRESETS, cycleEquip, equipGlyph } from './presets';

// Пікер техніки й пресети дієт — з прототипу (EQUIP_EXTRA, DIET_PRESETS).
// DIET_PRESETS у прототипі так і лишились заготовкою — визначені й ніде не
// використані. Тут вони стають чіпами: тап — і побажання записане, без
// набирання «безглютенова дієта» пальцем на телефоні.

describe('пікер техніки', () => {
  it('цикл: невідомо → є → немає → невідомо', () => {
    expect(cycleEquip(undefined)).toEqual({ op: 'add', has: true });
    expect(cycleEquip('has')).toEqual({ op: 'add', has: false });
    expect(cycleEquip('lacks')).toEqual({ op: 'remove' });
  });

  it('гліф відповідає стану', () => {
    expect(equipGlyph(undefined)).toBe('○');
    expect(equipGlyph('has')).toBe('●');
    expect(equipGlyph('lacks')).toBe('✕');
  });

  it('список із прототипу цілий і без дублів', () => {
    expect(EQUIP_EXTRA.length).toBeGreaterThanOrEqual(20);
    expect(new Set(EQUIP_EXTRA).size).toBe(EQUIP_EXTRA.length);
    expect(EQUIP_EXTRA).toContain('аерогриль');
    expect(EQUIP_EXTRA).toContain('казан');
  });
});

describe('пресети дієт', () => {
  it('десять із прототипу, без дублів', () => {
    expect(DIET_PRESETS).toHaveLength(10);
    expect(new Set(DIET_PRESETS).size).toBe(10);
    expect(DIET_PRESETS).toContain('веганство');
    expect(DIET_PRESETS).toContain('низький FODMAP');
  });
});
