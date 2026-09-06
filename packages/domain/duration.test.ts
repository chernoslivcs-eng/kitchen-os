// Крок Т1: тривалість людською. Живий репро — рецепт із ферментацією показував
// «10080ХВ»: число, яке людина не читає, а ділить у голові на 60 і на 24.

import { describe, expect, it } from 'vitest';
import { formatDuration } from './duration';

describe('formatDuration', () => {
  it('до двох годин включно — хвилини', () => {
    // У хвилинах людина міряє готування, і «90 хв» тут зрозуміліше за «1,5 год».
    expect(formatDuration(5)).toBe('5 хв');
    expect(formatDuration(25)).toBe('25 хв');
    expect(formatDuration(120)).toBe('120 хв');
  });

  it('за межею — години', () => {
    expect(formatDuration(121)).toBe('2 год');
    expect(formatDuration(180)).toBe('3 год');
    expect(formatDuration(10080)).toBe('168 год');
  });

  it('половина називається половиною, коли вона справжня', () => {
    expect(formatDuration(150)).toBe('2,5 год');
    expect(formatDuration(210)).toBe('3,5 год');
  });

  it('решта округлюється до цілих — вигаданої точності не буває', () => {
    // 200 хв це 3,33 год; «3,3 год» обіцяло б точність, якої в рецепті немає.
    expect(formatDuration(200)).toBe('3 год');
    expect(formatDuration(135)).toBe('2 год');
    expect(formatDuration(165)).toBe('3 год');
  });

  it('стиль caps — для рядка метаданих', () => {
    expect(formatDuration(25, 'caps')).toBe('25ХВ');
    expect(formatDuration(180, 'caps')).toBe('3ГОД');
    expect(formatDuration(150, 'caps')).toBe('2,5ГОД');
    expect(formatDuration(10080, 'caps')).toBe('168ГОД');
  });

  it('сміття на вході не стає «NaNХВ» на екрані', () => {
    expect(formatDuration(Number.NaN)).toBe('');
    expect(formatDuration(-5)).toBe('');
    expect(formatDuration(0)).toBe('0 хв');
  });
});
