import { describe, it, expect } from 'vitest';
import { applyMode } from './card-modes.js';
import { detectModes } from './modes.js';
import type { HouseholdEventRow } from './types.js';

// Знахідка A аудиту: відповідь на питання «чи застосовується ця картка одразу»
// жила в одному `if` усередині chat.ts, а промпт, пост-процесор і eval її
// ПЕРЕКАЗУВАЛИ прозою. Коли `if` змінили (Пул-8 №2, M13 01.09: intake_diff і
// shopping застосовуються без тапу), три перекази лишились на старому місці й
// узгоджено стверджували неправду. Тут — єдине джерело, яке всі троє читають.

describe('режим застосування картки', () => {
  it('сервер застосовує сам, тапу немає — auto', () => {
    expect(applyMode('intake_diff')).toBe('auto');
    expect(applyMode('shopping')).toBe('auto');
  });

  it('картка чекає тапу людини — confirm', () => {
    expect(applyMode('profile')).toBe('confirm');
    expect(applyMode('recipe')).toBe('confirm');
    expect(applyMode('cook_photo')).toBe('confirm');
  });

  it('застосовувати нічого — none', () => {
    expect(applyMode('proposal')).toBe('none');
    expect(applyMode('recipe_link')).toBe('none');
    expect(applyMode('recipe_edit')).toBe('none');
    expect(applyMode('cook_go')).toBe('none');
    expect(applyMode('cart')).toBe('none');
    expect(applyMode('cart_go')).toBe('none');
    expect(applyMode('retail_search_go')).toBe('none');
  });
});

describe('подія близько — режим, а не блок', () => {
  const mk = (rule: HouseholdEventRow['rule'], over: Partial<HouseholdEventRow> = {}): HouseholdEventRow => ({
    id: 'e1', household_id: 'h1', kind: 'custom', title: 'гості', note: null,
    rule, force: 'hint', restricts: null, buy: [], recipe_id: null, servings: null,
    supply: null, created_by: 'u1', source: 'user', expires_at: null, done_at: null,
    created_at: '2026-09-01T10:00:00.000Z', ...over,
  });
  const now = new Date(2026, 8, 10, 12, 0);   // чт, 10 вересня

  it('подія завтра стає режимом, і на відкритті сесії — з правилом', () => {
    const modes = detectModes([], [], now, [mk({ t: 'once', at: '2026-09-11' })]);
    const m = modes.find((x) => x.kind === 'event_near');
    expect(m?.label).toContain('ЗАВТРА');
    expect(m?.sessionOpening).toBe(true);
  });

  it('подія за тиждень режимом не стає — робити ще нічого', () => {
    expect(detectModes([], [], now, [mk({ t: 'once', at: '2026-09-20' })])
      .some((m) => m.kind === 'event_near')).toBe(false);
  });

  it('минуле не нагадується', () => {
    expect(detectModes([], [], now, [mk({ t: 'once', at: '2026-09-01' })])
      .some((m) => m.kind === 'event_near')).toBe(false);
  });

  it('закрите й згасле не рахується', () => {
    const done = mk({ t: 'once', at: '2026-09-11' }, { done_at: '2026-09-10T09:00:00.000Z' });
    const stale = mk({ t: 'once', at: '2026-09-11' }, { expires_at: '2026-09-05T00:00:00.000Z' });
    expect(detectModes([], [], now, [done, stale]).some((m) => m.kind === 'event_near')).toBe(false);
  });

  it('тижневе правило ловиться за найближчим своїм днем', () => {
    // Субота — за два дні від четверга.
    const m = detectModes([], [], now, [mk({ t: 'weekly', dow: 6 })])
      .find((x) => x.kind === 'event_near');
    expect(m?.label).toContain('ЗА 2 ДНІ');
  });

  it('найближча перемагає, коли їх кілька', () => {
    const modes = detectModes([], [], now, [
      mk({ t: 'once', at: '2026-09-13' }, { id: 'a', title: 'далека' }),
      mk({ t: 'once', at: '2026-09-11' }, { id: 'b', title: 'близька' }),
    ]);
    expect(modes.find((m) => m.kind === 'event_near')?.label).toContain('близька');
  });

  it('не на відкритті — режим є, але правило інше', () => {
    const msg = { id: 'm1', session_id: 's1', role: 'user' as const, text: 'привіт', card: null, applied: 0, created_at: '2026-09-10T11:00:00.000Z' };
    const m = detectModes([msg], [], now, [mk({ t: 'once', at: '2026-09-11' })])
      .find((x) => x.kind === 'event_near');
    expect(m?.sessionOpening).toBe(false);
  });
});
