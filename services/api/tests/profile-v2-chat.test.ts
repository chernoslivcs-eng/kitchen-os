import { describe, it, expect } from 'vitest';
import { buildDynamicContext } from '../src/model.js';
import { emptyProfileText } from '@kitchen/domain';

// Раунд 4, крок 3: модель ЧИТАЄ [ПРО ЛЮДИНУ] + [НОТАТКИ]. Крок 11: профіль v1
// і прапор прибрано. П5-В4: писати в профіль модель більше не вміє — картки
// поля немає, лишилось читання й рядок «впиши сама».

const base = { user_id: 'u1', session_id: 's1', text: 'що на вечерю', pantry: [] };

describe('динамічний контекст', () => {
  it('[ПРО ЛЮДИНУ] першим блоком, [НОТАТКИ] одразу за ним, далі [СЬОГОДНІ]', () => {
    const p = emptyProfileText('u1');
    p.fields.no = { text: 'мʼяса й птиці', status: 'filled', updated_at: null };
    const v2 = buildDynamicContext({ ...base, profileText: p, profileNotes: [] });
    expect(v2.indexOf('[ПРО ЛЮДИНУ — її власні слова]')).toBe(2);
    expect(v2).toContain('Я не їм мʼяса й птиці.');
    expect(v2).toContain('[НОТАТКИ — записав сам після розмов і готувань]');
    expect(v2).not.toContain('[ПРОФІЛЬ]');
    expect(v2).not.toContain('[ВИСНОВКИ З ГОТУВАННЯ]');
    expect(v2).not.toContain('[НАМІРИ]');
    expect(v2.indexOf('[СЬОГОДНІ]')).toBeGreaterThan(v2.indexOf('[НОТАТКИ'));
  });

  it('П1: блоку [ТРАДИЦІЇ] більше нема — свята йдуть у [ЗАРАЗ] за підпискою', () => {
    const p = emptyProfileText('u1');
    const ctx = buildDynamicContext({ ...base, profileText: p });
    expect(ctx).not.toContain('[ТРАДИЦІЇ]');
    expect(ctx).not.toContain('[СЕЗОН І СВЯТА]');
  });

  // П5-В5: їдців дому немає — блок теж.
  it('П5: блоку [ДОМАШНІ] більше нема', () => {
    const ctx = buildDynamicContext({ ...base, profileText: emptyProfileText('u1') });
    expect(ctx).not.toContain('[ДОМАШНІ]');
  });
});
