import { describe, it, expect } from 'vitest';
import { resolveWhen } from '../src/event-when.js';

const now = new Date(2026, 8, 3, 18, 0);   // 03.09.2026, четвер

describe('коли → правило', () => {
  it('дослівна дата лишається собою', () => {
    expect(resolveWhen({ date: '2026-09-12' }, now)).toEqual({ t: 'once', at: '2026-09-12' });
  });

  it('відносне рахує сервер, не модель', () => {
    expect(resolveWhen({ rel: '+7d' }, now)).toEqual({ t: 'once', at: '2026-09-10' });
    expect(resolveWhen({ rel: '+2w' }, now)).toEqual({ t: 'once', at: '2026-09-17' });
    expect(resolveWhen({ rel: 'tomorrow' }, now)).toEqual({ t: 'once', at: '2026-09-04' });
    expect(resolveWhen({ rel: 'today' }, now)).toEqual({ t: 'once', at: '2026-09-03' });
  });

  it('тривалість додається, коли її назвали', () => {
    // «Мама привезе цибулю за тиждень — тиждень готуємо з нею».
    expect(resolveWhen({ rel: '+7d' }, now, 7)).toEqual({ t: 'once', at: '2026-09-10', days: 7 });
  });

  it('тижневе правило', () => {
    expect(resolveWhen({ weekly: 2 }, now)).toEqual({ t: 'weekly', dow: 2 });
    expect(resolveWhen({ weekly: 7 }, now)).toBeNull();
  });

  it('невідома форма — null, а не «сьогодні»', () => {
    // Подія з вигаданою датою гірша за відсутню: вона виглядає як факт.
    expect(resolveWhen({ date: '12 вересня' }, now)).toBeNull();
    expect(resolveWhen({ rel: 'колись' }, now)).toBeNull();
    expect(resolveWhen({}, now)).toBeNull();
    expect(resolveWhen(null, now)).toBeNull();
    expect(resolveWhen('завтра', now)).toBeNull();
  });

  it('перехід через кінець місяця й року рахується календарно', () => {
    expect(resolveWhen({ rel: '+3d' }, new Date(2026, 11, 30))).toEqual({ t: 'once', at: '2027-01-02' });
  });

  it('крива тривалість ігнорується, дата лишається', () => {
    expect(resolveWhen({ date: '2026-09-12' }, now, 0)).toEqual({ t: 'once', at: '2026-09-12' });
    expect(resolveWhen({ date: '2026-09-12' }, now, 9999)).toEqual({ t: 'once', at: '2026-09-12' });
  });
});
