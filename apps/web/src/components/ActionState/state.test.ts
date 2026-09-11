import { describe, it, expect } from 'vitest';
import { actionState, clock } from './state';

const base = { sending: false, waited: 0, parsing: false, offline: false, throttledUntil: null, throttledKind: null, nothingChanged: false, cardConflict: false, now: 1_000_000 };

describe('стан дії — рядок над композитором', () => {
  it('спокій — рядка немає', () => {
    expect(actionState(base)).toBeNull();
  });

  it('думаю — sparkles, годинник і «Стоп»; розбір — інше слово', () => {
    const t = actionState({ ...base, sending: true, waited: 7 })!;
    expect(t.kind).toBe('thinking'); expect(t.icon).toBe('live.thinking');
    expect(t.text).toBe('Думаю · 0:07'); expect(t.action).toBe('stop');
    expect(actionState({ ...base, sending: true, waited: 65, parsing: true })!.text).toBe('Дивлюся, що тут · 1:05');
  });

  it('ліміт — hourglass, бурштин, і ЖОДНОГО «повторити»: повторювати рано', () => {
    const l = actionState({ ...base, throttledUntil: 1_060_000 })!;
    expect(l.kind).toBe('limit'); expect(l.icon).toBe('live.limit'); expect(l.tone).toBe('amber');
    expect(l.action).toBeNull();
    expect(l.text).toContain('Дай мені хвилину');
  });

  it('ліміт із kind — називає себе; без слова для виду — загальне', () => {
    expect(actionState({ ...base, throttledUntil: 1_060_000, throttledKind: 'recipe_gen' })!.text).toContain('Десять рецептів');
    expect(actionState({ ...base, throttledUntil: 1_060_000, throttledKind: 'track' })!.text).toContain('Дай мені хвилину');
  });

  it('ліміт, що вже минув, — не стан', () => {
    expect(actionState({ ...base, throttledUntil: 999_000 })).toBeNull();
  });

  it('мережа — wifi-off, danger, «Повторити»; і вона старша за ліміт і за «думаю»', () => {
    const o = actionState({ ...base, offline: true, sending: true, throttledUntil: 1_060_000 })!;
    expect(o.kind).toBe('offline'); expect(o.icon).toBe('live.offline'); expect(o.tone).toBe('danger');
    expect(o.action).toBe('retry');
  });

  it('ліміт старший за «думаю»: відповіді не буде, годинник не обіцяє', () => {
    expect(actionState({ ...base, sending: true, throttledUntil: 1_060_000 })!.kind).toBe('limit');
  });

  it('нічого не змінилось — minus, тихо, без дії', () => {
    const n = actionState({ ...base, nothingChanged: true })!;
    expect(n.kind).toBe('nothing'); expect(n.icon).toBe('live.nothing'); expect(n.action).toBeNull();
  });

  it('конфлікт — лише для карток (DEBT §34), «Оновити»', () => {
    const c = actionState({ ...base, cardConflict: true })!;
    expect(c.kind).toBe('conflict'); expect(c.action).toBe('refresh');
    expect(c.text).toContain('картку');
  });

  it('годинник', () => {
    expect(clock(7)).toBe('0:07'); expect(clock(65)).toBe('1:05');
  });
});
