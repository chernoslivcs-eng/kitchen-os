import { describe, it, expect } from 'vitest';
import { serializeCookRun } from '../context.js';

// UX9-28: дві страви за день для моделі були «два листи без дат у конверті» —
// порядок вона вгадувала і вгадала навпаки («другій поставив 4/5», а то була
// перша). Тепер сьогодні/вчора несуть час, а найсвіжіший запис позначений.
describe('serializeCookRun', () => {
  const now = new Date('2026-09-10T18:00:00').getTime();

  it('сьогодні — з часом HH:MM', () => {
    const s = serializeCookRun(
      { title: 'Паста з пармезаном', rating: 4, verdict: null, finished_at: '2026-09-10T15:24:00' },
      now,
    );
    expect(s).toContain('сьогодні 15:24');
    expect(s).toContain('★4/5');
  });

  it('вчора — з часом; давнє — без часу', () => {
    // Семантика 24h-вікон (QA4-08): «вчора» починається після повної доби.
    const yesterday = serializeCookRun(
      { title: 'Борщ', rating: null, verdict: null, finished_at: '2026-09-09T15:05:00' },
      now,
    );
    expect(yesterday).toContain('вчора 15:05');

    const old = serializeCookRun(
      { title: 'Різото', rating: null, verdict: null, finished_at: '2026-09-01T12:00:00' },
      now,
    );
    expect(old).toContain('9 дн тому');
    expect(old).not.toMatch(/\d{2}:\d{2}/);
  });

  it('latest=true → позначка «(останнє)»', () => {
    const s = serializeCookRun(
      { title: 'Паста', rating: null, verdict: null, finished_at: '2026-09-10T15:48:00' },
      now,
      true,
    );
    expect(s).toContain('(останнє)');
  });
});
