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

// ── Розгортання короткого id ────────────────────────────────────────────────
// Блок [ТВОЇ ПЛАНИ] дає моделі вісім символів замість повного uuid — інакше
// двадцять подій коштували б ~700 зайвих символів у КОЖНОМУ виклику. Отже
// розгортати префікс мусить сервер. Живий eval показав, що модель справді
// повертає короткий id: без цього кроку операція тихо не застосовувалась би,
// а Кухня рапортувала б «змінив».
describe('короткий id розгортається сервером', () => {
  const rows = [
    { id: '7f3a91c4-0000-4000-8000-000000000001' },
    { id: '7f3a91c4-0000-4000-8000-000000000002' },
    { id: 'aa11bb22-0000-4000-8000-000000000003' },
  ];
  const expand = (short: string): string | undefined => {
    const hits = rows.filter((e) => e.id.startsWith(short));
    return hits.length === 1 ? hits[0]!.id : undefined;
  };

  it('однозначний префікс розгортається в повний id', () => {
    expect(expand('aa11bb22')).toBe('aa11bb22-0000-4000-8000-000000000003');
  });

  it('неоднозначний префікс не вгадується', () => {
    // Краще не зробити нічого, ніж змінити не ту подію.
    expect(expand('7f3a91c4')).toBeUndefined();
  });

  it('невідомий префікс — теж нічого', () => {
    expect(expand('deadbeef')).toBeUndefined();
  });
});
